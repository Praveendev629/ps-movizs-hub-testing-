import { NextRequest, NextResponse } from "next/server";

// Simple cache for video responses to improve performance
const videoCache = new Map<string, { response: Response; timestamp: number }>();
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes for video streams

export async function GET(req: NextRequest) {
  const videoUrl = req.nextUrl.searchParams.get("url");
  
  console.log('Proxy request for URL:', videoUrl);
  
  if (!videoUrl) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }
  
  try {
    // Check cache for HEAD requests (metadata)
    const isHeadRequest = req.method === 'HEAD';
    const cacheKey = `${videoUrl}:${isHeadRequest ? 'head' : 'get'}`;
    
    // For HEAD requests, check cache first
    if (isHeadRequest) {
      const cached = videoCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Returning cached HEAD response');
        return new NextResponse(null, {
          status: 200,
          headers: cached.response.headers,
        });
      }
    }
    
    // Fetch the video stream with optimized headers
    console.log('Fetching video from:', videoUrl);
    
    // Optimized headers for faster streaming
    const headers = new Headers({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": new URL(videoUrl).origin,
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache", // Prevent caching issues
      "Pragma": "no-cache",
    });
    
    // Add specific headers for onestream.today with optimizations
    if (videoUrl.includes('onestream.today')) {
      headers.set("Referer", "https://dubmv.top/");
      headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8");
      headers.set("Accept-Language", "en-US,en;q=0.5");
      headers.set("Upgrade-Insecure-Requests", "1");
    }
    
    // Add range request support for better streaming
    const requestRange = req.headers.get("range");
    if (requestRange) {
      headers.set("Range", requestRange);
    }
    
    const response = await fetch(videoUrl, {
      headers,
      redirect: 'follow',
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    // Get content type from response or default to video/mp4
    const contentType = response.headers.get("content-type") || "video/mp4";
    
    // Get content length if available
    const contentLength = response.headers.get("content-length");
    const acceptRanges = response.headers.get("accept-ranges");
    const contentRange = response.headers.get("content-range");

    // Create optimized headers for the proxy response
    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Range",
      "Cache-Control": "public, max-age=3600, immutable",
      "Accept-Ranges": "bytes",
      "Connection": "keep-alive",
    });

    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    // Handle range requests for better streaming performance
    if (requestRange && acceptRanges === "bytes") {
      console.log('Handling range request:', requestRange);
      responseHeaders.set("Content-Range", contentRange || `bytes 0-${(contentLength ? parseInt(contentLength) - 1 : '*')}/${contentLength || '*'}`);
      
      // Cache HEAD responses for faster metadata retrieval
      if (isHeadRequest) {
        videoCache.set(cacheKey, { response: new Response(null, { headers: responseHeaders }), timestamp: Date.now() });
      }
      
      return new NextResponse(response.body, {
        status: 206, // Partial Content
        headers: responseHeaders,
      });
    }

    // For full video requests, add streaming optimization headers
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("X-Frame-Options", "SAMEORIGIN");

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

export async function HEAD(req: NextRequest) {
  // Reuse the GET logic but don't stream the body
  return GET(req);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Range",
    },
  });
}
