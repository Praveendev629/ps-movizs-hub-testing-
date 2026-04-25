import { NextRequest, NextResponse } from "next/server";
const TMDB_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJlZWM2ODQzYmIzNmEyNWU5NjMyMDE3NDcyMTlhN2E1ZSIsIm5iZiI6MTc3NzEwMjQ0NS44ODksInN1YiI6IjY5ZWM2ZTZkMmRlNGU2N2FlYjI4ZDJjNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.1-GGbq6qKfuyKxAPUDstsoSKd_ybv12hwzniRXi1NMg";

// Simple in-memory cache for better performance
const posterCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ poster: null });

  // Check cache first
  const cacheKey = q.toLowerCase().trim();
  const cached = posterCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached poster for:', q);
    return NextResponse.json(cached.data);
  }

  // Fast and efficient title cleaning
  const cleanTitle = q
    .replace(/\(\d{4}\)/g, "") // Remove years in parentheses
    .replace(/\b\d{4}\b/g, "") // Remove standalone years
    .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p|4K|2K)\b/gi, "") // Remove quality
    .replace(/\b(moviesda|isaidub|tamilrockers|tamilmv|movierulz|filmyzilla)\b/gi, "") // Remove site names
    .replace(/\.(mp4|mkv|avi|mov|webm)$/gi, "") // Remove file extensions
   .replace(/[^\w\s:-]/gi, " ")// Remove special chars
    .replace(/\s+/g, " ")
    .trim();

  console.log('Original:', q, '-> Cleaned:', cleanTitle);

  // Try TMDB API if key is available, otherwise skip to OMDB
  try {
   const tmdbKey = TMDB_API_KEY;
    if (tmdbKey) {
      console.log('Searching TMDB for:', cleanTitle);
      
      // Fast TMDB API call with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      try {
        let tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&api_key=${tmdbKey}&language=en-US&page=1&include_adult=false`,
          { 
            next: { revalidate: 86400 },
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            signal: controller.signal
          }
        );
        
        clearTimeout(timeoutId);
        
        if (!tmdbRes.ok) {
          throw new Error(`TMDB API error: ${tmdbRes.status}`);
        }
        
        let tmdbData = await tmdbRes.json();
        console.log('TMDB found:', tmdbData.results?.length || 0, 'movies');
        
        // If no results, try partial title
        if (!tmdbData.results?.length && cleanTitle.split(' ').length > 3) {
          const partialTitle = cleanTitle.split(' ').slice(0, 3).join(' ');
          console.log('Trying partial:', partialTitle);
          
          const partialController = new AbortController();
          const partialTimeoutId = setTimeout(() => partialController.abort(), 3000);
          
          try {
            tmdbRes = await fetch(
              `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(partialTitle)}&api_key=${tmdbKey}&language=en-US&page=1&include_adult=false`,
              { 
                next: { revalidate: 86400 },
                signal: partialController.signal
              }
            );
            
            clearTimeout(partialTimeoutId);
            tmdbData = await tmdbRes.json();
            console.log('TMDB partial found:', tmdbData.results?.length || 0, 'movies');
          } catch (partialError) {
            clearTimeout(partialTimeoutId);
            console.log('Partial search failed, using original results');
          }
        }
        
        // Get the first result with poster
        const movieWithPoster = tmdbData.results?.find((movie: any) => movie.poster_path);
        
        if (movieWithPoster?.poster_path) {
          const posterUrl = `https://image.tmdb.org/t/p/w500${movieWithPoster.poster_path}`;
          console.log('Found TMDB poster:', posterUrl);
          
          const result = { 
            poster: posterUrl,
            title: movieWithPoster.title,
            year: movieWithPoster.release_date?.split('-')[0],
            id: movieWithPoster.id
          };
          
          // Cache the result
          posterCache.set(cacheKey, { data: result, timestamp: Date.now() });
          
          return NextResponse.json(result);
        } else {
          console.log('No poster in TMDB results');
        }
      } catch (tmdbError) {
        clearTimeout(timeoutId);
        console.error('TMDB API failed:', tmdbError);
      }
    } else {
      console.log('TMDB API key not found, using OMDB fallback');
    }
  } catch (error) {
    console.error('TMDB setup error:', error);
  }

  // Fallback to OMDB if TMDB fails
  try {
    console.log('Trying OMDB fallback for:', cleanTitle);
    const omdbController = new AbortController();
    const omdbTimeoutId = setTimeout(() => omdbController.abort(), 3000);
    
    try {
      const omdbRes = await fetch(
        `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`,
        { 
          next: { revalidate: 86400 },
          signal: omdbController.signal
        }
      );
      
      clearTimeout(omdbTimeoutId);
      
      if (omdbRes.ok) {
        const omdbData = await omdbRes.json();
        
        if (omdbData.Poster && omdbData.Poster !== "N/A") {
          console.log('Found OMDB poster:', omdbData.Poster);
          
          const result = { poster: omdbData.Poster };
          posterCache.set(cacheKey, { data: result, timestamp: Date.now() });
          
          return NextResponse.json(result);
        }
      }
    } catch (omdbError) {
      clearTimeout(omdbTimeoutId);
      console.log('OMDB API failed, using fallback');
    }
  } catch (error) {
    console.error('OMDB setup error:', error);
  }

  // Generate fallback poster
  const posterTitle = cleanTitle || q;
  const fallbackPoster = `https://via.placeholder.com/500x750/1a1a1a/ff0000?text=${encodeURIComponent(posterTitle.replace(/\s+/g, '+'))}`;
  
  console.log('Using fallback poster for:', q);
  
  const result = { poster: fallbackPoster };
  posterCache.set(cacheKey, { data: result, timestamp: Date.now() });
  
  return NextResponse.json(result);
}
