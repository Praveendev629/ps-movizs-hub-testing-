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
  console.log('Extracting poster from Moviesda HTML for:', movieTitle);
  
  // Pattern 1: Look for movie poster in meta tags (most reliable)
  const metaPoster = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (metaPoster && metaPoster[1]) {
    console.log('Found poster in meta tag:', metaPoster[1]);
    return metaPoster[1];
  }

  // Pattern 2: Look for poster in Twitter card meta
  const twitterPoster = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (twitterPoster && twitterPoster[1]) {
    console.log('Found poster in Twitter meta:', twitterPoster[1]);
    return twitterPoster[1];
  }

  // Pattern 3: Look for images in main content area (before download sections)
  const mainContent = html.split(/class=["'](?:download|stream|watch|links)/i)[0];
  
  // Find images with poster-like classes or attributes
  const posterPatterns = [
    /<img[^>]*class=["'][^"']*(?:poster|movie|thumb|featured|main)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img[^>]*alt=["'][^"']*(?:poster|movie|thumb)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img[^>]*src=["']([^"']*\.(?:jpg|jpeg|png|webp))["'][^>]*(?:class|alt)=["'][^"']*(?:poster|movie|thumb|featured|main)[^"']*["']/i,
  ];

  for (const pattern of posterPatterns) {
    const match = mainContent.match(pattern);
    if (match && match[1]) {
      console.log('Found poster with pattern:', match[1]);
      return match[1];
    }
  }

  // Pattern 4: Look for the largest image in the content area (likely the poster)
  const allImages = mainContent.match(/<img[^>]*src=["']([^"']+\.(?:jpg|jpeg|png|webp))["'][^>]*>/gi);
  if (allImages && allImages.length > 0) {
    // Get the first image (usually the main poster)
    const firstImg = allImages[0].match(/src=["']([^"']+)["']/i);
    if (firstImg && firstImg[1]) {
      console.log('Found first image as poster:', firstImg[1]);
      return firstImg[1];
    }
  }

  // Pattern 5: Look for background images in CSS
  const bgImage = html.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
  if (bgImage && bgImage[1]) {
    console.log('Found poster in background image:', bgImage[1]);
    return bgImage[1];
  }

  // Pattern 6: Look for data attributes that might contain poster URLs
  const dataPoster = html.match(/data-(?:poster|image|src)=["']([^"']+)["']/i);
  if (dataPoster && dataPoster[1]) {
    console.log('Found poster in data attribute:', dataPoster[1]);
    return dataPoster[1];
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
    // Clean movie title for search (more aggressive cleaning)
    const cleanTitle = movieTitle
      .replace(/\(\d{4}\)/g, "") // Remove years
      .replace(/\b\d{4}\b/g, "") // Remove standalone years
      .replace(/\b(HD|HQ|DVDRip|BluRay|WEBRip|CAM|TS|TC|1080p|720p|480p|360p|4K|2K)\b/gi, "") // Remove quality
      .replace(/\b(moviesda|isaidub|tamilrockers|tamilmv|movierulz|filmyzilla|filmywap|9xmovies|bolly4u|mkvhub|hdhub4u|dotmovies|moviesflix|moviesverse|moviesnation|moviescounter|moviesbaba)\b/gi, "") // Remove site names
      .replace(/\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|3gp)$/gi, "") // Remove file extensions
      .replace(/\b(Original|Uncut|Extended|Director\'s Cut|Theatrical|Unrated|Remastered|Restored|Criterion|Special|Edition|Version|Cut)\b/gi, "") // Remove tags
      .replace(/[^\w\s]/gi, " ") // Remove special chars
      .replace(/\s+/g, " ")
      .trim();

    console.log('Cleaned title for search:', cleanTitle);

    // Try Moviesda19 specific approach based on site investigation
    try {
      console.log('Trying Moviesda19 structure');
      
      // Approach 1: Try Moviesda19 URL structure based on investigation
      const titleSlug = cleanTitle.toLowerCase().replace(/\s+/g, '-');
      const moviesda19Urls = [
        `https://moviesda19.com/${titleSlug}-moviesda/`,
        `https://moviesda19.com/${titleSlug}-tamil-movie/`,
        `https://moviesda19.com/${titleSlug}-movie/`,
        `https://moviesda19.com/${titleSlug}/`,
      ];

      for (const movieUrl of moviesda19Urls) {
        try {
          console.log('Trying Moviesda19 URL:', movieUrl);
          const movieHtml = await fetchMoviesdaHtml(movieUrl);
          const poster = extractPosterFromHtml(movieHtml, movieTitle);

          if (poster) {
            const absolutePoster = poster.startsWith('http')
              ? poster
              : `https://moviesda19.com${poster}`;

            console.log('Found poster via Moviesda19 URL:', absolutePoster);

            const result = { poster: absolutePoster };
            posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

            return NextResponse.json(result);
          }
        } catch (urlError) {
          // Continue to next URL
          continue;
        }
      }

      // Approach 2: Try Moviesda19 category pages to find the movie
      const categoryUrls = [
        `https://moviesda19.com/tamil-2023-movies/`,
        `https://moviesda19.com/tamil-2024-movies/`,
        `https://moviesda19.com/tamil-2025-movies/`,
        `https://moviesda19.com/tamil-2026-movies/`,
        `https://moviesda19.com/tamil-latest-updates/`,
      ];

      for (const categoryUrl of categoryUrls) {
        try {
          console.log('Searching in category:', categoryUrl);
          const categoryHtml = await fetchMoviesdaHtml(categoryUrl);
          
          // Look for movie link in category page
          const movieLinkPattern = new RegExp(`\\[([^\\]]*${cleanTitle.split(' ')[0]}[^\\]]*)\\]\\(https://moviesda19\\.com/([^)]+)\\)`, 'i');
          const movieMatch = categoryHtml.match(movieLinkPattern);
          
          if (movieMatch && movieMatch[2]) {
            const moviePageUrl = `https://moviesda19.com/${movieMatch[2]}`;
            console.log('Found movie in category:', moviePageUrl);
            
            try {
              const movieHtml = await fetchMoviesdaHtml(moviePageUrl);
              const poster = extractPosterFromHtml(movieHtml, movieTitle);

              if (poster) {
                const absolutePoster = poster.startsWith('http')
                  ? poster
                  : `https://moviesda19.com${poster}`;

                console.log('Found poster via category search:', absolutePoster);

                const result = { poster: absolutePoster };
                posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

                return NextResponse.json(result);
              }
            } catch (movieError) {
              continue;
            }
          }
        } catch (categoryError) {
          continue;
        }
      }

      // Approach 3: Try Moviesda19 A-Z pages
      const firstLetter = cleanTitle.charAt(0).toLowerCase();
      if (firstLetter.match(/[a-z]/)) {
        const azUrl = `https://moviesda19.com/tamil-movies/${firstLetter}/`;
        
        try {
          console.log('Searching in A-Z page:', azUrl);
          const azHtml = await fetchMoviesdaHtml(azUrl);
          
          // Look for movie link in A-Z page
          const movieLinkPattern = new RegExp(`\\[([^\\]]*${cleanTitle.split(' ')[0]}[^\\]]*)\\]\\(https://moviesda19\\.com/([^)]+)\\)`, 'i');
          const movieMatch = azHtml.match(movieLinkPattern);
          
          if (movieMatch && movieMatch[2]) {
            const moviePageUrl = `https://moviesda19.com/${movieMatch[2]}`;
            console.log('Found movie in A-Z page:', moviePageUrl);
            
            try {
              const movieHtml = await fetchMoviesdaHtml(moviePageUrl);
              const poster = extractPosterFromHtml(movieHtml, movieTitle);

              if (poster) {
                const absolutePoster = poster.startsWith('http')
                  ? poster
                  : `https://moviesda19.com${poster}`;

                console.log('Found poster via A-Z search:', absolutePoster);

                const result = { poster: absolutePoster };
                posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

                return NextResponse.json(result);
              }
            } catch (movieError) {
              continue;
            }
          }
        } catch (azError) {
          continue;
        }
      }

    } catch (moviesda19Error) {
      console.log('Moviesda19 approach failed:', moviesda19Error);
    }

    // Fallback: Try other Moviesda domains
    const fallbackDomains = ['moviesda18.com', 'moviesda.bar', 'moviesda.co', 'moviesda.vip'];
    
    for (const domain of fallbackDomains) {
      try {
        console.log(`Trying fallback domain: ${domain}`);
        
        const titleSlug = cleanTitle.toLowerCase().replace(/\s+/g, '-');
        const possibleUrls = [
          `https://${domain}/movie/${titleSlug}`,
          `https://${domain}/${titleSlug}`,
          `https://${domain}/movies/${titleSlug}`,
          `https://${domain}/download/${titleSlug}`,
        ];

        for (const movieUrl of possibleUrls) {
          try {
            console.log('Trying direct URL:', movieUrl);
            const movieHtml = await fetchMoviesdaHtml(movieUrl);
            const poster = extractPosterFromHtml(movieHtml, movieTitle);

            if (poster) {
              const absolutePoster = poster.startsWith('http')
                ? poster
                : `https://${domain}${poster}`;

              console.log('Found poster via direct URL:', absolutePoster);

              const result = { poster: absolutePoster };
              posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

              return NextResponse.json(result);
            }
          } catch (urlError) {
            // Continue to next URL
            continue;
          }
        }

        // Approach 2: Try search functionality
        const searchUrl = `https://${domain}/search?q=${encodeURIComponent(cleanTitle)}`;
        
        try {
          const searchHtml = await fetchMoviesdaHtml(searchUrl);
          
          // Look for movie links in search results with multiple patterns
          const linkPatterns = [
            /<a[^>]*href=["']([^"']+)["'][^>]*>.*?${cleanTitle.split(' ')[0]}.*?<\/a>/gi,
            /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*(?:movie|post|item)[^"']*["'][^>]*>.*?<\/a>/gi,
            /<a[^>]*href=["']([^"']*\/movie\/[^"']*)["'][^>]*>/gi,
          ];

          for (const pattern of linkPatterns) {
            const matches = searchHtml.match(pattern);
            if (matches && matches.length > 0) {
              for (const match of matches) {
                const hrefMatch = match.match(/href=["']([^"']+)["']/i);
                if (hrefMatch && hrefMatch[1]) {
                  const movieUrl = hrefMatch[1].startsWith('http')
                    ? hrefMatch[1]
                    : `https://${domain}${hrefMatch[1]}`;

                  console.log('Found movie link:', movieUrl);

                  try {
                    const movieHtml = await fetchMoviesdaHtml(movieUrl);
                    const poster = extractPosterFromHtml(movieHtml, movieTitle);

                    if (poster) {
                      const absolutePoster = poster.startsWith('http')
                        ? poster
                        : `https://${domain}${poster}`;

                      console.log('Found poster via search:', absolutePoster);

                      const result = { poster: absolutePoster };
                      posterCache.set(cacheKey, { data: result, timestamp: Date.now() });

                      return NextResponse.json(result);
                    }
                  } catch (movieError) {
                    // Continue to next match
                    continue;
                  }
                }
              }
            }
          }
        } catch (searchError) {
          console.log(`Search failed for ${domain}:`, searchError);
          // Continue to next domain
          continue;
        }

      } catch (domainError) {
        console.log(`Domain ${domain} failed:`, domainError);
        // Continue to next domain
        continue;
      }
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
