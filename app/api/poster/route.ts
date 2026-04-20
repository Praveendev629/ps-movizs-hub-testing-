import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ poster: null });

  // Clean movie title - remove year, quality info
  const cleanTitle = q
    .replace(/\(\d{4}\)/g, "")
    .replace(/\d{4}/g, "")
    .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p)\b/gi, "")
    .trim();
 
  try {
    // Try OMDB API (free key with limited requests)
    const omdbRes = await fetch(
      `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`,
      { next: { revalidate: 86400 } }
    );
    const omdbData = await omdbRes.json();
    if (omdbData.Poster && omdbData.Poster !== "N/A") {
      return NextResponse.json({ poster: omdbData.Poster });
    }
  } catch {}

  try {
    // Fallback: TMDB search
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
