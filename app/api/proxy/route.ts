import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const videoUrl = req.nextUrl.searchParams.get("url");
  
  console.log('Proxy request for URL:', videoUrl);
  
  if (!videoUrl) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }
  
  try {
    // Fetch the video stream with proper headers
    console.log('Fetching video from:', videoUrl);
    
    // Special handling for onestream.today URLs
    const headers = new Headers({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": new URL(videoUrl).origin,
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
    });
    
    // Add specific headers for onestream.today
    if (videoUrl.includes('onestream.today')) {
      headers.set("Referer", "https://dubmv.top/");
      headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
      headers.set("Accept-Language", "en-US,en;q=0.5");
      headers.set("Upgrade-Insecure-Requests", "1");
    }
    
    const response = await fetch(videoUrl, {
      headers,
      redirect: 'follow' // Follow redirects
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    // Get content type from response or detect from URL
    let contentType = response.headers.get("content-type");
    
    // If content type is not provided or is generic, detect from URL
    if (!contentType || contentType.includes("application/octet-stream") || contentType.includes("application/force-download")) {
      const urlLower = videoUrl.toLowerCase();
      if (urlLower.includes('.m3u8')) {
        contentType = "application/vnd.apple.mpegurl";
      } else if (urlLower.includes('.mp4')) {
        contentType = "video/mp4";
      } else if (urlLower.includes('.webm')) {
        contentType = "video/webm";
      } else if (urlLower.includes('.mkv')) {
        contentType = "video/x-matroska";
      } else if (urlLower.includes('.avi')) {
        contentType = "video/x-msvideo";
      } else if (urlLower.includes('.mov')) {
        contentType = "video/quicktime";
      } else {
        contentType = "video/mp4"; // Default fallback
      }
    }
    
    // Get content length if available
    const contentLength = response.headers.get("content-length");

    // Create headers for the proxy response
    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Cache-Control": "public, max-age=3600",
    });

    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    // Handle range requests for video streaming
    const range = req.headers.get("range");
    if (range) {
      console.log('Range request:', range);
      
      // If the original response supports range requests, proxy them
      if (response.headers.get("accept-ranges") === "bytes") {
        responseHeaders.set("Accept-Ranges", "bytes");
        responseHeaders.set("Content-Range", response.headers.get("content-range") || `bytes 0-${(contentLength ? parseInt(contentLength) - 1 : '*')}/${contentLength || '*'}`);
        
        // Forward the range request to the original server
        const rangeResponse = await fetch(videoUrl, {
          headers: {
            ...Object.fromEntries(headers.entries()),
            "Range": range
          },
          redirect: 'follow'
        });
        
        if (rangeResponse.ok) {
          const finalHeaders: Record<string, string> = {
            ...Object.fromEntries(responseHeaders.entries()),
            "Accept-Ranges": "bytes"
          };
          
          const contentRange = rangeResponse.headers.get("content-range") || responseHeaders.get("Content-Range");
          if (contentRange) {
            finalHeaders["Content-Range"] = contentRange;
          }
          
          const finalContentLength = rangeResponse.headers.get("content-length") || contentLength;
          if (finalContentLength) {
            finalHeaders["Content-Length"] = finalContentLength;
          }
          
          return new NextResponse(rangeResponse.body, {
            status: rangeResponse.status === 206 ? 206 : 200,
            headers: finalHeaders,
          });
        }
      }
      
      // If we can't handle range requests, at least set the header
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Failed to proxy video stream" },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
    },
  });
}
