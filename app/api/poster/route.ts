import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (!q) return NextResponse.json({ poster: null });

  // Enhanced movie title cleaning for better TMDB search
  const cleanTitle = q
    // Remove year in parentheses
    .replace(/\(\d{4}\)/g, "")
    // Remove standalone years
    .replace(/\b\d{4}\b/g, "")
    // Remove quality indicators
    .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|TS|TC|1080p|720p|480p|360p|4K|2K)\b/gi, "")
    // Remove source/site names
    .replace(/\b(moviesda|isaidub|tamilrockers|tamilmv|tamilblasters|movierulz|filmyzilla|filmywap|9xmovies|bolly4u|mkvhub|hdhub4u|dotmovies|moviesflix|moviesverse|moviesnation|moviescounter|moviesbaba|moviesda|moviesflix|moviesverse|moviesnation|moviescounter|moviesbaba)\b/gi, "")
    // Remove file extensions
    .replace(/\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|3gp)$/gi, "")
    // Remove common tags
    .replace(/\b(Original|Uncut|Extended|Director\'s Cut|Theatrical|Unrated|Remastered|Restored|Criterion|Special|Edition|Version|Cut)\b/gi, "")
    // Remove special characters and extra spaces
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  console.log('Original title:', q);
  console.log('Cleaned title for TMDB:', cleanTitle);

  // Prioritize TMDB API for better results
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (tmdbKey) {
      console.log('Searching TMDB for:', cleanTitle);
      
      // First try exact search
      let tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&api_key=${tmdbKey}&language=en-US&page=1&include_adult=false`,
        { 
          next: { revalidate: 86400 },
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
      
      let tmdbData = await tmdbRes.json();
      console.log('TMDB search results:', tmdbData.results?.length || 0, 'movies found');
      
      // If no results, try with partial title (first 3 words)
      if (!tmdbData.results?.length && cleanTitle.split(' ').length > 3) {
        const partialTitle = cleanTitle.split(' ').slice(0, 3).join(' ');
        console.log('Trying partial title:', partialTitle);
        
        tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(partialTitle)}&api_key=${tmdbKey}&language=en-US&page=1&include_adult=false`,
          { next: { revalidate: 86400 } }
        );
        tmdbData = await tmdbRes.json();
        console.log('TMDB partial search results:', tmdbData.results?.length || 0, 'movies found');
      }
      
      // Get the first result with poster
      const movieWithPoster = tmdbData.results?.find((movie: any) => movie.poster_path);
      
      if (movieWithPoster?.poster_path) {
        const posterUrl = `https://image.tmdb.org/t/p/w500${movieWithPoster.poster_path}`;
        console.log('Found TMDB poster:', posterUrl);
        console.log('Movie details:', movieWithPoster.title, movieWithPoster.release_date);
        
        return NextResponse.json({ 
          poster: posterUrl,
          title: movieWithPoster.title,
          year: movieWithPoster.release_date?.split('-')[0],
          id: movieWithPoster.id
        });
      } else {
        console.log('No poster found in TMDB results');
      }
    } else {
      console.log('TMDB API key not found in environment');
    }
  } catch (error) {
    console.error('TMDB API error:', error);
  }

  // Fallback to OMDB if TMDB fails
  try {
    console.log('Trying OMDB fallback for:', cleanTitle);
    const omdbRes = await fetch(
      `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}&type=movie&apikey=trilogy`,
      { next: { revalidate: 86400 } }
    );
    const omdbData = await omdbRes.json();
    
    if (omdbData.Poster && omdbData.Poster !== "N/A") {
      console.log('Found OMDB poster:', omdbData.Poster);
      return NextResponse.json({ poster: omdbData.Poster });
    }
  } catch (error) {
    console.error('OMDB API error:', error);
  }

  console.log('No poster found for:', q);
  return NextResponse.json({ poster: null });
}
