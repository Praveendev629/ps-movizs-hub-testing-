import { NextRequest, NextResponse } from "next/server";

async function resolveVideoUrl(streamPageUrl: string): Promise<string | null> {
  try {
    console.log('Resolving stream page:', streamPageUrl);
    
    // First try a simple approach - check if this is a direct video URL or redirect
    try {
      const headResponse = await fetch(streamPageUrl, {
        method: 'HEAD',
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://dubmv.top/",
        },
        redirect: 'follow'
      });
        
      const contentType = headResponse.headers.get('content-type') || '';
      const finalUrl = headResponse.url;
      
      console.log('HEAD response - Content-Type:', contentType);
      console.log('HEAD response - Final URL:', finalUrl);
      
      // If we got a video content type or the final URL is a video file, return it
      if (contentType.includes('video/') || finalUrl.includes('.mp4') || finalUrl.includes('.m3u8') || finalUrl.includes('.webm')) {
        console.log('Found direct video URL via HEAD:', finalUrl);
        return finalUrl;
      }
    } catch (headError) {
      console.log('HEAD request failed, trying full page parse');
    }
    
    // Fetch the stream page with better headers
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
    });

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

    for (const pattern of videoPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (url && (url.includes('.mp4') || url.includes('.m3u8') || url.includes('.webm') || url.includes('.mkv') || url.includes('.avi') || url.includes('.mov'))) {
          console.log('Found video URL:', url);
          return url;
        }
      }
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
      return metaRefresh[1];
    }
    
    console.log('No video URL found in stream page');
    
    // As a last resort, return the original URL - the video player or proxy might handle it
    console.log('Returning original URL as fallback:', streamPageUrl);
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
