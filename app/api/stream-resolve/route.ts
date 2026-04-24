import { NextRequest, NextResponse } from "next/server";

// Simple in-memory cache for stream URLs (reset on server restart)
const streamCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function resolveVideoUrl(streamPageUrl: string): Promise<string | null> {
  try {
    console.log('Resolving stream page:', streamPageUrl);
    
    // Check cache first
    const cached = streamCache.get(streamPageUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('Returning cached stream URL:', cached.url);
      return cached.url;
    }
    
    // Fast timeout for HEAD request (3 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    try {
      const headResponse = await fetch(streamPageUrl, {
        method: 'HEAD',
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://dubmv.top/",
        },
        redirect: 'follow',
        signal: controller.signal
      });
        
      const contentType = headResponse.headers.get('content-type') || '';
      const finalUrl = headResponse.url;
      
      console.log('HEAD response - Content-Type:', contentType);
      console.log('HEAD response - Final URL:', finalUrl);
      
      // If we got a video content type or the final URL is a video file, return it
      if (contentType.includes('video/') || finalUrl.includes('.mp4') || finalUrl.includes('.m3u8') || finalUrl.includes('.webm')) {
        console.log('Found direct video URL via HEAD:', finalUrl);
        clearTimeout(timeoutId);
        
        // Cache the result
        streamCache.set(streamPageUrl, { url: finalUrl, timestamp: Date.now() });
        
        return finalUrl;
      }
    } catch (headError) {
      clearTimeout(timeoutId);
      console.log('HEAD request failed or timed out, trying full page parse');
    }
    
    // Fetch the stream page with timeout (8 seconds)
    const pageController = new AbortController();
    const pageTimeoutId = setTimeout(() => pageController.abort(), 8000);
    
    const response = await fetch(streamPageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://dubmv.top/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: pageController.signal
    });

    clearTimeout(pageTimeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch stream page: ${response.status}`);
    }

    const html = await response.text();
    console.log('Stream page HTML length:', html.length);
    console.log('First 500 chars of HTML:', html.substring(0, 500));

    // Look for video sources in the HTML with more comprehensive patterns
    const videoPatterns = [
      // Standard HTML5 video sources
      /source\s+src=["']([^"']+)["']/gi,
      /video[^>]+src=["']([^"']+)["']/gi,
      // Direct video file URLs
      /["']([^"']*\.(?:mp4|m3u8|webm|mkv|avi|mov)[^"']*)["']/gi,
      // JavaScript object properties
      /file:\s*["']([^"']+)["']/gi,
      /url:\s*["']([^"']+)["']/gi,
      /src:\s*["']([^"']+)["']/gi,
      // Data attributes
      /data-src=["']([^"']+)["']/gi,
      /data-url=["']([^"']+)["']/gi,
      // Common streaming patterns
      /["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
      // Base64 encoded URLs (less common but possible)
      /atob\(["']([^"']+)["']\)/gi,
    ];

    // Collect all video URLs first, then filter and prioritize
    const foundVideoUrls: { url: string; score: number }[] = [];
    
    for (const pattern of videoPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (url && (url.includes('.mp4') || url.includes('.m3u8') || url.includes('.webm') || url.includes('.mkv') || url.includes('.avi') || url.includes('.mov'))) {
          console.log('Found video URL:', url);
          
          // Score the URL to prioritize full movies
          let score = 0;
          const urlLower = url.toLowerCase();
          
          // Penalize sample/trailer content
          const samplePatterns = [
            'sample', 'trailer', 'preview', 'demo', 'teaser',
            'clip', 'snippet', 'excerpt', 'test', 'intro'
          ];
          
          samplePatterns.forEach(pattern => {
            if (urlLower.includes(pattern)) {
              score -= 100; // Heavy penalty for samples
            }
          });
          
          // Bonus for full movie indicators
          const movieIndicators = [
            'movie', 'film', 'full', 'complete', 'original',
            'hd', '720p', '1080p', 'bluray', 'web-dl'
          ];
          
          movieIndicators.forEach(indicator => {
            if (urlLower.includes(indicator)) {
              score += 50; // Bonus for movie content
            }
          });
          
          // Bonus for larger files (extract from URL if possible)
          const sizeMatch = url.match(/(\d+)mb/i);
          if (sizeMatch) {
            const size = parseInt(sizeMatch[1]);
            if (size > 200) {
              score += 30; // Large files are likely full movies
            } else if (size < 50) {
              score -= 50; // Small files are likely samples
            }
          }
          
          foundVideoUrls.push({ url, score });
        }
      }
    }
    
    // Sort by score and return the best (highest scoring) URL
    if (foundVideoUrls.length > 0) {
      foundVideoUrls.sort((a, b) => b.score - a.score);
      const bestUrl = foundVideoUrls[0].url;
      console.log('Selected best video URL:', bestUrl, 'Score:', foundVideoUrls[0].score);
      
      // Cache the result
      streamCache.set(streamPageUrl, { url: bestUrl, timestamp: Date.now() });
      
      return bestUrl;
    }

    // Look for iframe or embed sources
    const iframePatterns = [
      /iframe[^>]+src="([^"]+)"/gi,
      /embed[^>]+src="([^"]+)"/gi,
    ];

    for (const pattern of iframePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (url && !url.includes('ads') && !url.includes('popup')) {
          console.log('Found iframe URL:', url);
          
          // Cache the result
          streamCache.set(streamPageUrl, { url, timestamp: Date.now() });
          
          return url;
        }
      }
    }

    // Look for JavaScript variables that might contain the video URL
    const jsPatterns = [
      // Variable assignments
      /var\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      /const\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      /let\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      // Object properties
      /videoUrl\s*:\s*["']([^"']+)["']/gi,
      /video_src\s*:\s*["']([^"']+)["']/gi,
      /source\s*:\s*["']([^"']+)["']/gi,
      /src\s*:\s*["']([^"']+)["']/gi,
      /url\s*:\s*["']([^"']+)["']/gi,
      // Function calls
      /playVideo\(["']([^"']+)["']\)/gi,
      /loadVideo\(["']([^"']+)["']\)/gi,
      /setSrc\(["']([^"']+)["']\)/gi,
      // JSON-like structures
      /["'](src|source|url|file)["']\s*:\s*["']([^"']+)["']/gi,
    ];

    for (const pattern of jsPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[2] || match[1]; // Handle both patterns
        if (url && (url.includes('.mp4') || url.includes('.m3u8') || url.includes('.webm') || url.includes('.mkv') || url.includes('.avi') || url.includes('.mov'))) {
          console.log('Found JS video URL:', url);
          
          // Cache the result
          streamCache.set(streamPageUrl, { url, timestamp: Date.now() });
          
          return url;
        }
      }
    }

    // If no direct video URL found, try to look for external API calls or scripts
    console.log('No direct video URL found, looking for external sources...');
    
    // Look for external script tags that might contain video URLs
    const scriptPatterns = [
      /<script[^>]*src=["']([^"']+)["'][^>]*>/gi,
      /<script[^>]*>([^<]+)<\/script>/gi,
    ];
    
    for (const pattern of scriptPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const scriptContent = match[1] || match[2];
        if (scriptContent && scriptContent.includes('http')) {
          console.log('Found script:', scriptContent.substring(0, 200));
          
          // Try to extract video URLs from script content
          const scriptVideoPatterns = [
            /["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mkv|avi|mov)[^"']*)["']/gi,
          ];
          
          for (const scriptPattern of scriptVideoPatterns) {
            let scriptMatch;
            while ((scriptMatch = scriptPattern.exec(scriptContent)) !== null) {
              const url = scriptMatch[1];
              if (url) {
                console.log('Found video URL in script:', url);
                
                // Cache the result
                streamCache.set(streamPageUrl, { url, timestamp: Date.now() });
                
                return url;
              }
            }
          }
        }
      }
    }
    
    // As a last resort, try to follow redirects or look for meta refresh
    const metaRefresh = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;url=([^"']+)["']/i);
    if (metaRefresh && metaRefresh[1]) {
      console.log('Found meta refresh to:', metaRefresh[1]);
      
      // Cache the result
      streamCache.set(streamPageUrl, { url: metaRefresh[1], timestamp: Date.now() });
      
      return metaRefresh[1];
    }
    
    console.log('No video URL found in stream page');
    
    // As a last resort, return the original URL - the video player or proxy might handle it
    console.log('Returning original URL as fallback:', streamPageUrl);
    
    // Cache the fallback result
    streamCache.set(streamPageUrl, { url: streamPageUrl, timestamp: Date.now() });
    
    return streamPageUrl;

  } catch (error) {
    console.error('Error resolving video URL:', error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const streamUrl = req.nextUrl.searchParams.get("url");
  
  if (!streamUrl) {
    return NextResponse.json({ error: "Stream URL parameter is required" }, { status: 400 });
  }

  try {
    const videoUrl = await resolveVideoUrl(streamUrl);
    
    if (!videoUrl) {
      return NextResponse.json({ error: "Could not resolve video URL" }, { status: 404 });
    }

    return NextResponse.json({ videoUrl });

  } catch (error) {
    console.error("Stream resolve error:", error);
    return NextResponse.json(
      { error: "Failed to resolve stream" },
      { status: 500 }
    );
  }
}
