import { NextRequest, NextResponse } from "next/server";

const SITE_BASES: Record<string, string> = {
  moviesda: "https://moviesda31.com",
  isaidub: "https://isaidub.guru",
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

/** Try to scrape the movie poster from the source site movie page */
async function scrapeSitePoster(movieUrl: string, site: string): Promise<string | null> {
  const siteBase = SITE_BASES[site];
  if (!siteBase || !movieUrl) return null;

  try {
    const fullUrl = movieUrl.startsWith("http") ? movieUrl : `${siteBase}${movieUrl}`;
    const res = await fetch(fullUrl, {
      headers: HEADERS,
      next: { revalidate: 86400 },
    });
    const html = await res.text();

    // Look for poster: <source srcset="/uploads/posters/slug.webp" type="image/webp">
    //                  <img src="/uploads/posters/slug.jpg" ...>
    const posterMatch =
      html.match(/<source[^>]+srcset="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i) ||
      html.match(/<img[^>]+src="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i);

    if (posterMatch && posterMatch[1]) {
      const path = posterMatch[1];
      return path.startsWith("http") ? path : `${siteBase}${path}`;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const movieUrl = req.nextUrl.searchParams.get("movieUrl") || "";
  const site = req.nextUrl.searchParams.get("site") || "";

  if (!q && !movieUrl) return NextResponse.json({ poster: null });

  // ── 1. Try source-site poster (fastest & most accurate for Tamil movies) ──
  if (movieUrl && site) {
    const sitePoster = await scrapeSitePoster(movieUrl, site);
    if (sitePoster) {
      return NextResponse.json({ poster: sitePoster });
    }
  }

  // ── 2. Clean title for external API lookups ────────────────────────────────
  const cleanTitle = q
    .replace(/\(\d{4}\)/g, "")
    .replace(/\d{4}/g, "")
    .replace(
      /\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p)\b/gi,
      ""
    )
    .trim();

  if (!cleanTitle) return NextResponse.json({ poster: null });

  // ── 3. OMDB API ───────────────────────────────────────────────────────────
  try {
    const omdbRes = await fetch(
      `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`,
      { next: { revalidate: 86400 } }
    );
    const omdbData = await omdbRes.json();
    if (omdbData.Poster && omdbData.Poster !== "N/A") {
      return NextResponse.json({ poster: omdbData.Poster });
    }
  } catch {}

  // ── 4. TMDB API ───────────────────────────────────────────────────────────
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (tmdbKey) {
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&api_key=${tmdbKey}`,
        { next: { revalidate: 86400 } }
      );
      const tmdbData = await tmdbRes.json();
      const first = tmdbData.results?.[0];
      if (first?.poster_path) {
        return NextResponse.json({
          poster: `https://image.tmdb.org/t/p/w500${first.poster_path}`,
        });
      }
    }
  } catch {}

  return NextResponse.json({ poster: null });
}
