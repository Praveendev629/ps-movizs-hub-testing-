import { NextRequest, NextResponse } from "next/server";

// Simple in-memory cache for better performance
const posterCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Helper function to fetch HTML from Moviesda
async function fetchMoviesdaHtml(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Moviesda page: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error('Error fetching Moviesda HTML:', error);
    throw error;
  }
}

// Helper function to extract poster from Moviesda HTML
function extractPosterFromHtml(html: string, movieTitle: string): string | null {
  // Try multiple patterns to find poster images

  // Pattern 1: Look for movie poster in meta tags
  const metaPoster = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (metaPoster && metaPoster[1]) {
    console.log('Found poster in meta tag:', metaPoster[1]);
    return metaPoster[1];
  }

  // Pattern 2: Look for poster in image tags with movie/poster classes
  const posterImg = html.match(/<img[^>]*class=["'][^"']*(?:movie|poster|thumb)[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (posterImg && posterImg[1]) {
    console.log('Found poster in image tag:', posterImg[1]);
    return posterImg[1];
  }

  // Pattern 3: Look for any image that might be a poster (before download links)
  const beforeDownload = html.split(/download|watch|stream/i)[0];
  const anyImg = beforeDownload.match(/<img[^>]*src=["']([^"']+\.(?:jpg|jpeg|png|webp))["'][^>]*>/i);
  if (anyImg && anyImg[1]) {
    console.log('Found potential poster image:', anyImg[1]);
    return anyImg[1];
  }

  // Pattern 4: Look for background images in CSS
  const bgImage = html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
  if (bgImage && bgImage[1]) {
    console.log('Found poster in background image:', bgImage[1]);
    return bgImage[1];
  }

  console.log('No poster found in Moviesda HTML for:', movieTitle);
  return null;
}

export async function GET(req: NextRequest) {
  const movieTitle = req.nextUrl.searchParams.get("q") || "";
  if (!movieTitle) return NextResponse.json({ poster: null });

  // Check cache first
  const cacheKey = movieTitle.toLowerCase().trim();
  const cached = posterCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached poster for:', movieTitle);
    return NextResponse.json(cached.data);
  }

  console.log('Fetching poster from Moviesda for:', movieTitle);

  try {
    // Clean movie title for search
    const cleanTitle = movieTitle
      .replace(/\(\d{4}\)/g, "") // Remove years
      .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|1080p|720p|480p|360p|4K|2K)\b/gi, "") // Remove quality
      .replace(/\b(moviesda|isaidub|tamilrockers|tamilmv|movierulz|filmyzilla)\b/gi, "") // Remove site names
      .replace(/\.(mp4|mkv|avi|mov|webm)$/gi, "") // Remove file extensions
      .replace(/[^\w\s]/gi, " ") // Remove special chars
      .replace(/\s+/g, " ")
      .trim();

    console.log('Cleaned title for search:', cleanTitle);

    // Try to search Moviesda for the movie
    const searchUrl = `https://moviesda18.com/search?q=${encodeURIComponent(cleanTitle)}`;

    try {
      const searchHtml = await fetchMoviesdaHtml(searchUrl);

      // Look for movie link in search results
      const movieLinkMatch = searchHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>.*?${cleanTitle.split(' ')[0]}.*?<\/a>/i);

      if (movieLinkMatch && movieLinkMatch[1]) {
        const movieUrl = movieLinkMatch[1].startsWith('http')
          ? movieLinkMatch[1]
          : `https://moviesda18.com${movieLinkMatch[1]}`;

        console.log('Found movie URL:', movieUrl);

        // Fetch the movie page to extract poster
        const movieHtml = await fetchMoviesdaHtml(movieUrl);
        const poster = extractPosterFromHtml(movieHtml, movieTitle);

        if (poster) {
          // Ensure poster URL is absolute
          const absolutePoster = poster.startsWith('http')
            ? poster
            : `https://moviesda18.com${poster}`;

          console.log('Found Moviesda poster:', absolutePoster);

          const result = { poster: absolutePoster };
          posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

          return NextResponse.json(result);
        }
      }
    } catch (searchError) {
      console.log('Moviesda search failed, trying direct patterns:', searchError);
    }

    // Fallback: Try to construct poster URL based on common Moviesda patterns
    const titleSlug = cleanTitle.toLowerCase().replace(/\s+/g, '-');
    const possiblePosters = [
      `https://moviesda18.com/wp-content/uploads/${titleSlug}-poster.jpg`,
      `https://moviesda18.com/wp-content/uploads/${titleSlug}.jpg`,
      `https://moviesda18.com/images/${titleSlug}.jpg`,
      `https://moviesda18.com/posters/${titleSlug}.jpg`,
    ];

    // Try each possible poster URL
    for (const posterUrl of possiblePosters) {
      try {
        const posterResponse = await fetch(posterUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000)
        });

        if (posterResponse.ok) {
          console.log('Found poster via pattern:', posterUrl);

          const result = { poster: posterUrl };
          posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

          return NextResponse.json(result);
        }
      } catch (posterError) {
        // Continue to next pattern
        continue;
      }
    }

    console.log('No Moviesda poster found for:', movieTitle);

  } catch (error) {
    console.error('Error fetching Moviesda poster:', error);
  }

  // Generate fallback poster
  const fallbackPoster = `https://via.placeholder.com/500x750/1a1a1a/ff0000?text=${encodeURIComponent(movieTitle.replace(/\s+/g, '+'))}`;

  console.log('Using fallback poster for:', movieTitle);

  const result = { poster: fallbackPoster };
  posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return NextResponse.json(result);
}
