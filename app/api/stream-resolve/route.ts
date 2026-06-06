import { NextRequest, NextResponse } from "next/server";

async function resolveVideoUrl(streamPageUrl: string): Promise<string | null> {
  try {
    console.log("Resolving stream page:", streamPageUrl);

    // Check if HEAD shows a direct video
    try {
      const headResponse = await fetch(streamPageUrl, {
        method: "HEAD",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://moviesda31.com/",
        },
        redirect: "follow",
      });

      const contentType = headResponse.headers.get("content-type") || "";
      const finalUrl = headResponse.url;

      if (
        contentType.includes("video/") ||
        finalUrl.includes(".mp4") ||
        finalUrl.includes(".m3u8") ||
        finalUrl.includes(".webm")
      ) {
        console.log("Found direct video URL via HEAD:", finalUrl);
        return finalUrl;
      }
    } catch (headError) {
      console.log("HEAD request failed, trying full page parse");
    }

    // Fetch the stream page
    const response = await fetch(streamPageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: streamPageUrl.includes("dub.onestream.today")
          ? "https://isaidub.guru/"
          : "https://moviesda31.com/",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stream page: ${response.status}`);
    }

    const html = await response.text();
    console.log("Stream page HTML length:", html.length);

    // ─── Priority 1: <source src="..." type="video/..."> ─────────────────────
    // This is what play.onestream.today and dub.onestream.today return:
    //   <source src="https://cdn.uptomkv.ch/download.php?dl=...&stream=1" type="video/mp4">
    const sourceSrcRe = /<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\/[^"']+["'][^>]*>/gi;
    let srcMatch: RegExpExecArray | null;
    while ((srcMatch = sourceSrcRe.exec(html)) !== null) {
      const url = srcMatch[1];
      if (url && url.startsWith("http")) {
        console.log("Found <source> video URL:", url);
        return url;
      }
    }

    // Also check reversed attribute order: type first, then src
    const sourceSrcRe2 = /<source[^>]+type=["']video\/[^"']+["'][^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((srcMatch = sourceSrcRe2.exec(html)) !== null) {
      const url = srcMatch[1];
      if (url && url.startsWith("http")) {
        console.log("Found <source> video URL (reversed):", url);
        return url;
      }
    }

    // ─── Priority 2: CDN domain patterns ─────────────────────────────────────
    // Matches cdn.uptomkv.ch, dub.uptodub.ch, cdn.dubshare.* URLs
    const cdnRe = /["'](https?:\/\/(?:cdn\.|dub\.|s\d+\.)(?:uptomkv|uptodub|dubshare)[^"']+)["']/gi;
    let cdnMatch: RegExpExecArray | null;
    while ((cdnMatch = cdnRe.exec(html)) !== null) {
      const url = cdnMatch[1];
      if (url) {
        console.log("Found CDN URL:", url);
        return url;
      }
    }

    // ─── Priority 3: standard video patterns ─────────────────────────────────
    const videoPatterns = [
      /source\s+src=["']([^"']+)["']/gi,
      /video[^>]+src=["']([^"']+)["']/gi,
      /["']([^"']*\.(?:mp4|m3u8|webm|mkv|avi|mov)[^"']*)["']/gi,
      /file:\s*["']([^"']+)["']/gi,
      /url:\s*["']([^"']+)["']/gi,
      /src:\s*["']([^"']+)["']/gi,
      /data-src=["']([^"']+)["']/gi,
      /data-url=["']([^"']+)["']/gi,
      /["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
    ];

    for (const pattern of videoPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (
          url &&
          (url.includes(".mp4") ||
            url.includes(".m3u8") ||
            url.includes(".webm") ||
            url.includes(".mkv") ||
            url.includes(".avi") ||
            url.includes(".mov"))
        ) {
          console.log("Found video URL:", url);
          return url;
        }
      }
    }

    // ─── Priority 4: iframe/embed ─────────────────────────────────────────────
    const iframePatterns = [
      /iframe[^>]+src="([^"]+)"/gi,
      /embed[^>]+src="([^"]+)"/gi,
    ];

    for (const pattern of iframePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (url && !url.includes("ads") && !url.includes("popup")) {
          console.log("Found iframe URL:", url);
          return url;
        }
      }
    }

    // ─── Priority 5: JS variables ─────────────────────────────────────────────
    const jsPatterns = [
      /var\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      /const\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      /let\s+(videoUrl|video_src|source|src|url)\s*=\s*["']([^"']+)["']/gi,
      /videoUrl\s*:\s*["']([^"']+)["']/gi,
      /video_src\s*:\s*["']([^"']+)["']/gi,
      /["'](src|source|url|file)["']\s*:\s*["']([^"']+)["']/gi,
    ];

    for (const pattern of jsPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[2] || match[1];
        if (
          url &&
          (url.includes(".mp4") ||
            url.includes(".m3u8") ||
            url.includes(".webm") ||
            url.includes(".mkv") ||
            url.includes(".avi") ||
            url.includes(".mov"))
        ) {
          console.log("Found JS video URL:", url);
          return url;
        }
      }
    }

    // ─── Meta refresh ─────────────────────────────────────────────────────────
    const metaRefresh = html.match(
      /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;url=([^"']+)["']/i
    );
    if (metaRefresh && metaRefresh[1]) {
      console.log("Found meta refresh to:", metaRefresh[1]);
      return metaRefresh[1];
    }

    console.log("No video URL found – returning original as fallback");
    return streamPageUrl;
  } catch (error) {
    console.error("Error resolving video URL:", error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const streamUrl = req.nextUrl.searchParams.get("url");

  if (!streamUrl) {
    return NextResponse.json(
      { error: "Stream URL parameter is required" },
      { status: 400 }
    );
  }

  try {
    const videoUrl = await resolveVideoUrl(streamUrl);

    if (!videoUrl) {
      return NextResponse.json(
        { error: "Could not resolve video URL" },
        { status: 404 }
      );
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
