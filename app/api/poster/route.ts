import { NextRequest, NextResponse } from "next/server";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

/** Extract year from a movie title string like "Karuppu (2021)" */
function extractYear(title: string): string | undefined {
  const m = title.match(/\((\d{4})\)/);
  return m ? m[1] : undefined;
}

/** Clean title for external API lookups */
function cleanTitle(title: string): string {
  return title
    .replace(/\(\d{4}\)/g, "")
    .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p|Tamil|Dubbed|Hindi|Telugu|Malayalam)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Enhance IMDB poster URL to get larger image */
function enhanceImdbPosterUrl(url: string): string {
  // IMDB thumbnail: https://m.media-amazon.com/images/M/...@._V1_SX67.jpg
  // Replace size suffix to get 500px width
  return url
    .replace(/@\._V1_[\w,]+\.jpg/, "@._V1_SX500.jpg")
    .replace(/@\._V1_[\w,]+\.png/, "@._V1_SX500.png")
    .replace(/\._V1_SX\d+/, "._V1_SX500")
    .replace(/\._V1_SY\d+_SX\d+/, "._V1_SX500")
    .replace(/_CR\d+,\d+,\d+,\d+_AL_/, "");
}

/**
 * Search IMDB directly using the find page.
 * Returns poster URL and IMDB ID for the best-matching title.
 */
async function searchIMDB(
  title: string,
  year?: string
): Promise<{ poster: string | null; imdbId: string | null }> {
  const query = year ? `${title} ${year}` : title;
  const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(query)}&s=tt&ttype=ft&ref_=fn_mv`;

  try {
    const res = await fetch(searchUrl, {
      headers: FETCH_HEADERS,
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { poster: null, imdbId: null };

    const html = await res.text();

    // ── Try __NEXT_DATA__ JSON first (most reliable) ─────────────────────────
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/
    );
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const results: any[] =
          data?.props?.pageProps?.titleResults?.results || [];

        if (results.length > 0) {
          // Prefer an exact year match
          let best = results[0];
          if (year && results.length > 1) {
            const yearMatch = results.find(
              (r: any) =>
                String(r.titleReleaseText ?? "").includes(year) ||
                r.titleReleaseText === year
            );
            if (yearMatch) best = yearMatch;
          }

          let posterUrl: string | null =
            best?.titlePosterImageModel?.url ??
            best?.imageModel?.url ??
            null;

          if (posterUrl && !posterUrl.includes("nopicture")) {
            posterUrl = enhanceImdbPosterUrl(posterUrl);
          } else {
            posterUrl = null;
          }

          const imdbId: string | null = best?.id ?? null;
          return { poster: posterUrl, imdbId };
        }
      } catch {
        // JSON parse failed – fall through to HTML scraping
      }
    }

    // ── Fallback: scrape HTML search results ─────────────────────────────────
    // Look for poster image in search result rows
    const imgMatch =
      html.match(
        /class="[^"]*find-result-item[^"]*"[\s\S]*?<img[^>]+src="(https?:\/\/m\.media-amazon\.com\/[^"]+)"/i
      ) ||
      html.match(
        /<img[^>]+src="(https?:\/\/m\.media-amazon\.com\/images\/[^"]+)"[^>]*>/i
      );

    if (imgMatch && imgMatch[1] && !imgMatch[1].includes("nopicture")) {
      return {
        poster: enhanceImdbPosterUrl(imgMatch[1]),
        imdbId: null,
      };
    }

    return { poster: null, imdbId: null };
  } catch {
    return { poster: null, imdbId: null };
  }
}

/**
 * Get IMDB rating via OMDB API.
 * Pass imdbId when available for the most accurate match.
 */
async function getIMDBRating(
  title: string,
  year?: string,
  imdbId?: string
): Promise<string | null> {
  try {
    let url: string;
    if (imdbId) {
      url = `https://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`;
    } else {
      url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&type=movie${
        year ? `&y=${year}` : ""
      }&apikey=trilogy`;
    }
    const res = await fetch(url, { next: { revalidate: 86400 } });
    const data = await res.json();
    if (data.imdbRating && data.imdbRating !== "N/A") {
      return data.imdbRating;
    }
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ poster: null, rating: null });

  const year = extractYear(q);
  const clean = cleanTitle(q);
  if (!clean) return NextResponse.json({ poster: null, rating: null });

  // ── 1. IMDB direct search (primary – no watermarks) ───────────────────────
  const { poster: imdbPoster, imdbId } = await searchIMDB(clean, year);

  // ── 2. IMDB Rating via OMDB (most accurate when imdbId is known) ──────────
  const rating = await getIMDBRating(clean, year, imdbId ?? undefined);

  if (imdbPoster) {
    return NextResponse.json({ poster: imdbPoster, rating });
  }

  // ── 3. Fallback: OMDB (returns IMDB CDN poster + rating in one call) ───────
  try {
    const omdbUrl = `https://www.omdbapi.com/?t=${encodeURIComponent(clean)}&type=movie${
      year ? `&y=${year}` : ""
    }&apikey=trilogy`;
    const omdbRes = await fetch(omdbUrl, { next: { revalidate: 86400 } });
    const omdbData = await omdbRes.json();
    if (omdbData.Poster && omdbData.Poster !== "N/A") {
      const omdbRating =
        omdbData.imdbRating && omdbData.imdbRating !== "N/A"
          ? omdbData.imdbRating
          : rating;
      return NextResponse.json({ poster: omdbData.Poster, rating: omdbRating });
    }
  } catch {}

  // ── 4. Fallback: TMDB ────────────────────────────────────────────────────────
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (tmdbKey) {
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(
          clean
        )}&api_key=${tmdbKey}${year ? `&year=${year}` : ""}`,
        { next: { revalidate: 86400 } }
      );
      const tmdbData = await tmdbRes.json();
      const first = tmdbData.results?.[0];
      if (first?.poster_path) {
        return NextResponse.json({
          poster: `https://image.tmdb.org/t/p/w500${first.poster_path}`,
          rating,
        });
      }
    }
  } catch {}

  return NextResponse.json({ poster: null, rating });
}
