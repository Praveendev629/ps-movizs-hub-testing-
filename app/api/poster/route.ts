import { NextRequest, NextResponse } from "next/server";

// Simple cache for poster responses
const posterCache = new Map<string, { poster: string | null; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Timeout helper for Node.js compatibility
function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function cleanMovieTitle(title: string): string {
  return title
    .replace(/\(\d{4}\)/g, "") // Remove years in parentheses
    .replace(/\b\d{4}\b/g, "") // Remove standalone years
    .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p|4K|HDR)\b/gi, "") // Remove quality indicators
    .replace(/\b(Original|Uncut|Extended|Director's|Theatrical)\b/gi, "") // Remove version info
    .replace(/\[.*?\]/g, "") // Remove brackets content
    .replace(/\(.*?\)/g, "") // Remove parentheses content (except years)
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/gi, "") // Remove file extensions
    .replace(/\b(Moviesda|Mobi|com|www)\b/gi, "") // Remove site names
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

function extractYearFromTitle(title: string): number | null {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  return yearMatch ? parseInt(yearMatch[0]) : null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ poster: null });

  // Check cache first
  const cacheKey = q.toLowerCase();
  const cached = posterCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ poster: cached.poster });
  }

  const cleanTitle = cleanMovieTitle(q);
  const year = extractYearFromTitle(q);
  
  console.log('Fetching poster for:', { original: q, clean: cleanTitle, year });

  let poster: string | null = null;

  // Try 1: OMDB API with year for better accuracy
  try {
    const omdbUrl = year 
      ? `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&y=${year}&type=movie&apikey=trilogy`
      : `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`;
    
    const omdbRes = await fetch(omdbUrl, { 
      next: { revalidate: 86400 },
      signal: createTimeoutSignal(10000) // 10 second timeout
    });
    const omdbData = await omdbRes.json();
    
    if (omdbData.Poster && omdbData.Poster !== "N/A") {
      poster = omdbData.Poster;
      console.log('Found poster via OMDB:', poster);
    }
  } catch (error) {
    console.log('OMDB API failed:', error);
  }

  // Try 2: TMDB API with year filter
  if (!poster) {
    try {
      const tmdbKey = process.env.TMDB_API_KEY;
      if (tmdbKey) {
        const tmdbUrl = year
          ? `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&year=${year}&api_key=${tmdbKey}`
          : `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&api_key=${tmdbKey}`;
        
        const tmdbRes = await fetch(tmdbUrl, { 
          next: { revalidate: 86400 },
          signal: createTimeoutSignal(10000)
        });
        const tmdbData = await tmdbRes.json();
        
        // Find the best match by year if available
        let bestMatch = tmdbData.results?.[0];
        if (year && tmdbData.results?.length > 1) {
          bestMatch = tmdbData.results.find((movie: any) => {
            const movieYear = new Date(movie.release_date).getFullYear();
            return Math.abs(movieYear - year) <= 1; // Allow 1 year difference
          }) || tmdbData.results[0];
        }
        
        if (bestMatch?.poster_path) {
          poster = `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}`;
          console.log('Found poster via TMDB:', poster);
        }
      }
    } catch (error) {
      console.log('TMDB API failed:', error);
    }
  }

  // Try 3: Alternative OMDB search without year (broader search)
  if (!poster && year) {
    try {
      const omdbRes = await fetch(
        `https://www.omdbapi.com/?s=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`,
        { next: { revalidate: 86400 },
          signal: createTimeoutSignal(10000)
        }
      );
      const omdbData = await omdbRes.json();
      
      if (omdbData.Search && omdbData.Search.length > 0) {
        // Find the best match by year
        let bestMatch = omdbData.Search[0];
        if (omdbData.Search.length > 1) {
          bestMatch = omdbData.Search.find((movie: any) => {
            const movieYear = parseInt(movie.Year);
            return Math.abs(movieYear - year) <= 1;
          }) || omdbData.Search[0];
        }
        
        if (bestMatch.Poster && bestMatch.Poster !== "N/A") {
          poster = bestMatch.Poster;
          console.log('Found poster via OMDB search:', poster);
        }
      }
    } catch (error) {
      console.log('OMDB search failed:', error);
    }
  }

  // Try 4: TMDB search without year (last resort)
  if (!poster) {
    try {
      const tmdbKey = process.env.TMDB_API_KEY;
      if (tmdbKey) {
        const tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle.split(' ')[0])}&api_key=${tmdbKey}`,
          { next: { revalidate: 86400 },
            signal: createTimeoutSignal(10000)
          }
        );
        const tmdbData = await tmdbRes.json();
        const first = tmdbData.results?.[0];
        if (first?.poster_path) {
          poster = `https://image.tmdb.org/t/p/w500${first.poster_path}`;
          console.log('Found poster via partial TMDB search:', poster);
        }
      }
    } catch (error) {
      console.log('Partial TMDB search failed:', error);
    }
  }

  // If no poster found, create a default poster
  if (!poster) {
    // Generate a default poster URL using a placeholder service
    const posterText = encodeURIComponent(cleanTitle || q);
    poster = `https://via.placeholder.com/300x450/1f2937/ffffff?text=${posterText}`;
    console.log('Generated default poster:', poster);
  }

  // Cache the result
  posterCache.set(cacheKey, { poster, timestamp: Date.now() });

  return NextResponse.json({ poster });
}
