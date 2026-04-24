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

    // Get content type from response or default to video/mp4
    const contentType = response.headers.get("content-type") || "video/mp4";
    
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
    if (range && response.headers.get("accept-ranges") === "bytes") {
      responseHeaders.set("Accept-Ranges", "bytes");
      responseHeaders.set("Content-Range", response.headers.get("content-range") || `bytes 0-${(contentLength ? parseInt(contentLength) - 1 : '*')}/${contentLength || '*'}`);
      return new NextResponse(response.body, {
        status: 206, // Partial Content
        headers: responseHeaders,
      });
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
