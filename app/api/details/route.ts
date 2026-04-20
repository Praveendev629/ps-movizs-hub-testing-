import { NextRequest, NextResponse } from "next/server";

const SITES: Record<string, string> = {
  moviesda: "https://moviesda18.com",
  isaidub: "https://isaidub.love",
  animesalt: "https://animesalt.ac",
};
   
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

async function fetchHtml(url: string, referer?: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) },
    next: { revalidate: 600 },
  });
  return res.text();
}

function extractHrefLinks(
  html: string,
  pattern: RegExp
): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const url = m[1];
    const name = (m[2] || "").replace(/<[^>]+>/g, "").trim();
    if (url && name && !links.find((l) => l.url === url)) {
      links.push({ name, url });
    }
  }
  return links;
}

/**
 * Moviesda download chain:
 * /download/slug/ → download.moviespage.xyz/download/file/ID → movies.downloadpage.xyz/download/page/ID → CDN links
 */
async function resolveMoviesdaChain(
  pageUrl: string,
  siteBase: string
): Promise<{
  serverLinks: { name: string; url: string }[];
  watchLinks: { name: string; url: string }[];
}> {
  const fullUrl = pageUrl.startsWith("http")
    ? pageUrl
    : `${siteBase}${pageUrl}`;
  const html1 = await fetchHtml(fullUrl, siteBase);

  // Step 1: find download.moviespage.xyz link
  const step1 = extractHrefLinks(
    html1,
    /href="(https?:\/\/download\.moviespage\.xyz\/download\/file\/\d+)"[^>]*>([^<]+)/gi
  );

  let html3 = "";

  if (step1.length > 0) {
    const html2 = await fetchHtml(step1[0].url, siteBase);
    // Step 2: find movies.downloadpage.xyz link
    const step2 = extractHrefLinks(
      html2,
      /href="(https?:\/\/movies\.downloadpage\.xyz\/download\/page\/\d+)"[^>]*>([^<]+)/gi
    );
    if (step2.length > 0) {
      html3 = await fetchHtml(step2[0].url, step1[0].url);
    } else {
      html3 = html2;
    }
  } else {
    html3 = html1;
  }

  // Extract CDN download links
  const dlLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/cdn\.[^"]+|https?:\/\/s\d+\.[^"]+\.(?:mp4|mkv)[^"]*)"[^>]*>([^<]+)/gi
  );

  // Extract watch links - improved patterns to catch more streaming links
  let watchLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:play|stream|watch|online|video)[^"]+|https?:\/\/[^"]*(?:stream|watch|play|online|video)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log('Moviesda - Initial watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  Initial ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Additional extraction for direct video streams that might not have proper text
  const directVideoLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/[^"]*\.(?:mp4|m3u8|webm|mkv)[^"]*)"[^>]*>/gi
  );

  // Specific pattern for moviesda streaming sites - handle actual flow pattern
  const moviesdaStreamLinks2 = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:download\.moviespage\.xyz\/download\/file\/\d+|movies\.downloadpage\.xyz\/download\/file\/\d+|stream\.onestream\.today\/stream\/page\/\d+))"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log('Moviesda - Stream links found:', moviesdaStreamLinks2.length);
  moviesdaStreamLinks2.forEach((link, i) => {
    console.log(`  Stream ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Also try to catch any onestream variations from moviesda
  const onestreamVariations = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:download\.moviespage\.xyz\/download\/file\/\d+|movies\.downloadpage\.xyz\/download\/file\/\d+))"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log('Moviesda - Onestream variations found:', onestreamVariations.length);
  onestreamVariations.forEach((link, i) => {
    console.log(`  Variation ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Resolve moviesda streaming links to stream-resolve URLs
  const resolvedMoviesdaLinks = [];
  for (const link of moviesdaStreamLinks2) {
    try {
      console.log(`Resolving Moviesda link: ${link.name} -> ${link.url}`);
      
      // For onestream links, use stream-resolve API
      if (link.url.includes('onestream.today')) {
        console.log(`  -> Direct onestream link, using stream-resolve`);
        resolvedMoviesdaLinks.push({
          name: link.name,
          url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
        });
      } else if (link.url.includes('download.moviespage.xyz') || link.url.includes('movies.downloadpage.xyz')) {
        // For moviesda streaming pages, convert to stream page URL
        const fileId = link.url.match(/\/file\/(\d+)/)?.[1] || link.url.match(/\/download\/(\d+)/)?.[1];
        console.log(`  -> Moviesda download link, extracted file ID: ${fileId}`);
        if (fileId) {
          const streamUrl = `https://stream.onestream.today/stream/page/${fileId}`;
          console.log(`  -> Converted to stream URL: ${streamUrl}`);
          resolvedMoviesdaLinks.push({
            name: link.name,
            url: `/api/stream-resolve?url=${encodeURIComponent(streamUrl)}`
          });
        } else {
          console.log(`  -> Could not extract file ID, using original URL`);
          resolvedMoviesdaLinks.push(link);
        }
      } else {
        console.log(`  -> Other link type, using as-is`);
        // For other links, use as-is
        resolvedMoviesdaLinks.push(link);
      }
    } catch (error) {
      console.error('Error resolving moviesda link:', error);
    }
  }

  // Also resolve onestream variations
  for (const link of onestreamVariations) {
    try {
      if (link.url.includes('onestream.today')) {
        resolvedMoviesdaLinks.push({
          name: link.name,
          url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
        });
      } else if (link.url.includes('download.moviespage.xyz') || link.url.includes('movies.downloadpage.xyz')) {
        // For moviesda streaming pages, convert to stream page URL
        const fileId = link.url.match(/\/file\/(\d+)/)?.[1] || link.url.match(/\/download\/(\d+)/)?.[1];
        if (fileId) {
          const streamUrl = `https://stream.onestream.today/stream/page/${fileId}`;
          resolvedMoviesdaLinks.push({
            name: link.name,
            url: `/api/stream-resolve?url=${encodeURIComponent(streamUrl)}`
          });
        } else {
          resolvedMoviesdaLinks.push(link);
        }
      } else {
        resolvedMoviesdaLinks.push(link);
      }
    } catch (error) {
      console.error('Error resolving onestream variation:', error);
    }
  }

  // Additional extraction for streaming domains
  const streamingLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:[^"]*\.?stream[^"]*|[^"]*\.?play[^"]*|[^"]*\.?watch[^"]*|dub[^"]*|video[^"]*)[^"]+)"[^>]*>/gi
  );

  // Merge all watch links, removing duplicates
  const allWatchLinks = [...watchLinks, ...resolvedMoviesdaLinks, ...onestreamVariations, ...directVideoLinks, ...streamingLinks];
  watchLinks = allWatchLinks.filter((link, index, self) => 
    index === self.findIndex((l) => l.url === link.url)
  );

  // Debug logging for watch links
  console.log('Moviesda - Found watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Comprehensive fallback: grab all streaming links with multiple patterns
  if (dlLinks.length === 0) {
    const allLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/[^"#]+)"[^>]*>\s*((?:Download|Watch|Stream|Play|Online|Video|Now)[^<]+)/gi
    );
    
    // Filter for download links
    const dl = allLinks.filter((l) => l.name.toLowerCase().includes("download"));
    
    // Comprehensive filter for watch links - catch any possible streaming link
    const wl = allLinks.filter((l) => {
      const name = l.name.toLowerCase();
      const url = l.url.toLowerCase();
      return name.includes("watch") || 
             name.includes("stream") || 
             name.includes("play") || 
             name.includes("online") ||
             name.includes("video") ||
             url.includes("stream") ||
             url.includes("play") ||
             url.includes("watch") ||
             url.includes("video") ||
             url.includes("onestream") ||
             url.includes("moviespage") ||
             url.includes("downloadpage");
    });
    
    return { serverLinks: dl, watchLinks: wl };
  }

  return { serverLinks: dlLinks, watchLinks };
}

/**
 * Isaidub download chain:
 * /download/page/ID/ → dubpage.xyz/download/view/ID → dubmv.top/download/file/ID → CDN links
 */
async function resolveIsaidubChain(
  pageUrl: string,
  siteBase: string
): Promise<{
  serverLinks: { name: string; url: string }[];
  watchLinks: { name: string; url: string }[];
}> {
  const fullUrl = pageUrl.startsWith("http")
    ? pageUrl
    : `${siteBase}${pageUrl}`;
  const html1 = await fetchHtml(fullUrl, siteBase);

  // Step 1: dubpage.xyz
  const step1 = extractHrefLinks(
    html1,
    /href="(https?:\/\/dubpage\.xyz\/download\/view\/\d+)"[^>]*>([^<]+)/gi
  );

  let html3 = "";
  if (step1.length > 0) {
    const html2 = await fetchHtml(step1[0].url, siteBase);
    // Step 2: dubmv.top
    const step2 = extractHrefLinks(
      html2,
      /href="(https?:\/\/dubmv\.top\/download\/file\/\d+)"[^>]*>([^<]+)/gi
    );
    if (step2.length > 0) {
      html3 = await fetchHtml(step2[0].url, step1[0].url);
    } else {
      html3 = html2;
    }
  } else {
    html3 = html1;
  }

  // Extract CDN download links (dubshare)
  const dlLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/s\d+\.dubshare\.[^"]+)"[^>]*>(Download[^<]+)/gi
  );

  // Extract watch links - improved patterns to catch more streaming links
  let watchLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:dub\.[^"]*stream|stream|watch|play|online|video)[^"]+|https?:\/\/[^"]*(?:stream|watch|play|online|video)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log('Isaidub - Initial watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  Initial ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Specific pattern for onestream.today links found in isaidub
  const onestreamLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/dub\.onestream\.today\/stream\/video\/\d+)"[^>]*>(Watch[^<]+)/gi
  );

  console.log('Isaidub - Onestream links found:', onestreamLinks.length);
  onestreamLinks.forEach((link, i) => {
    console.log(`  Onestream ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Resolve onestream links to actual video URLs
  const resolvedOnestreamLinks = [];
  for (const link of onestreamLinks) {
    try {
      // For now, just pass the onestream URL - the frontend will resolve it
      // This avoids making the details API too slow
      resolvedOnestreamLinks.push({
        name: link.name,
        url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
      });
    } catch (error) {
      console.error('Error resolving onestream link:', error);
    }
  }

  // Additional extraction for direct video streams that might not have proper text
  const directVideoLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/[^"]*\.(?:mp4|m3u8|webm|mkv)[^"]*)"[^>]*>/gi
  );

  // Additional extraction for streaming domains (specific to isaidub)
  const streamingLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:[^"]*\.?stream[^"]*|[^"]*\.?play[^"]*|[^"]*\.?watch[^"]*|dub[^"]*|video[^"]*|dubshare[^"]*)[^"]+)"[^>]*>/gi
  );

  // Merge all watch links, removing duplicates
  const allWatchLinks = [...watchLinks, ...resolvedOnestreamLinks, ...directVideoLinks, ...streamingLinks];
  watchLinks = allWatchLinks.filter((link, index, self) => 
    index === self.findIndex((l) => l.url === link.url)
  );

  // Debug logging for watch links
  console.log('Isaidub - Found watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  ${i + 1}. ${link.name}: ${link.url}`);
  });

  if (dlLinks.length === 0) {
    const allLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/[^"#]+)"[^>]*>\s*((?:Download|Watch|Stream|Play|Online|Video|Now)[^<]+)/gi
    );
    const dl = allLinks.filter((l) => l.name.toLowerCase().includes("download"));
    const wl = allLinks.filter((l) => l.name.toLowerCase().includes("watch") || 
                                   l.name.toLowerCase().includes("stream") || 
                                   l.name.toLowerCase().includes("play") || 
                                   l.name.toLowerCase().includes("online"));
    return { serverLinks: dl, watchLinks: wl };
  }

  return { serverLinks: dlLinks, watchLinks };
}

/**
 * Extract sub-navigation items from a movie/anime detail page.
 * Returns quality groups, quality options, or file list items.
 * Strictly filters out A-Z nav links and site navigation.
 */
function extractSubItems(
  html: string,
  pageUrl: string,
  site: string
): { name: string; url: string }[] {
  const items: { name: string; url: string }[] = [];

  // For animesalt, extract anime episode/detail links
  if (site === "animesalt") {
    const cleanHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "");

    // Try to find episode links or anime detail links
    const episodeRe =
      /<a[^>]+href="([^"]*(?:episode|ep|watch|anime)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = episodeRe.exec(cleanHtml)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]*>/g, "").trim();
      
      if (!text || text.length < 2) continue;
      if (text.match(/^(home|login|register|search|menu)/i)) continue;
      if (href.includes(".jpg") || href.includes(".png")) continue;
      
      if (!items.find((i) => i.url === href)) {
        items.push({ name: text, url: href });
      }
    }

    // Fallback: get all internal anime-related links
    if (items.length === 0) {
      const allLinkRe = /<a[^>]+href="(\/[^"?#]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((m = allLinkRe.exec(cleanHtml)) !== null) {
        const href = m[1];
        const text = m[2].trim();
        
        if (!text || text.length < 2) continue;
        if (href.match(/(anime|episode|watch)/i)) {
          if (!items.find((i) => i.url === href)) {
            items.push({ name: text, url: href });
          }
        }
      }
    }

    return items;
  }

  // Remove noisy blocks (moviesda/isaidub)
  const cleanHtml = html
    .replace(/<div[^>]*class="[^"]*alpha-list[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<div[^>]*class="[^"]*Tag[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Method 1: .coral class links (these are the file/download item links on moviesda/isaidub)
  const coralRe =
    /<a[^>]+href="(\/[^"?#]+)"[^>]*class="coral"[^>]*>\s*(?:<strong>)?([^<]+)(?:<\/strong>)?\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = coralRe.exec(cleanHtml)) !== null) {
    const href = m[1];
    const text = m[2].trim();
    if (!text || text.length < 2) continue;
    if (!items.find((i) => i.url === href)) items.push({ name: text, url: href });
  }

  if (items.length > 0) return items;

  // Method 2: internal links that are sub-pages (have movie/quality context)
  // Only pick links that are clearly sub-pages of the current movie
  // Current page: /kumbaari-2024-tamil-movie/
  // Sub-pages: /kumbaari-original-movie/, /kumbaari-720p-hd-movie/, /download/xxx/
  const allLinkRe =
    /<a[^>]+href="(\/[^"?#]+)"[^>]*>([^<]+)<\/a>/gi;

  // Skip links text patterns
  const skipTexts = new Set([
    "Home", "Contact Us", "DMCA", "Download Now", "Go to Home",
    "SMS", "Facebook", "Twitter", "Whatsapp", "Telegram Channel",
    "Facebook Fan Page", "Telegram Update Page",
    "A","B","C","D","E","F","G","H","I","J","K","L","M",
    "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  ]);

  // Skip URL patterns
  const skipUrlRe =
    /^\/(?:tamil-\d{4}-movies|tamil-dubbed|tamilrockers|tamil-hd|tamil-web-series|tamil-movies-collection|moviesda-tamil|tamil-atoz|tamil-yearly|tamil-single|latest-updates|home\.php|movies\/[a-z]\/)[\/?]/;

  while ((m = allLinkRe.exec(cleanHtml)) !== null) {
    const href = m[1];
    const text = m[2].trim();

    if (!text || text.length < 2) continue;
    if (skipTexts.has(text)) continue;
    if (/^\d+$/.test(text) || /^»|«$/.test(text)) continue;
    if (skipUrlRe.test(href)) continue;
    if (href === pageUrl || href === "/") continue;

    if (!items.find((i) => i.url === href)) {
      items.push({ name: text, url: href });
    }
  }

  return items;
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url") || "";
  const site = req.nextUrl.searchParams.get("site") || "moviesda";
  const siteBase = SITES[site] || SITES.moviesda;

  if (!urlParam)
    return NextResponse.json({ items: [], serverLinks: [], watchLinks: [] });

  try {
    // Detect if this is a download trigger page
    const isMoviesdaDownload =
      site === "moviesda" && /^\/download\//.test(urlParam);
    const isIsaidubDownload =
      site === "isaidub" && /^\/download\/page\//.test(urlParam);

    if (isMoviesdaDownload) {
      const result = await resolveMoviesdaChain(urlParam, siteBase);
      return NextResponse.json({ items: [], ...result });
    }

    if (isIsaidubDownload) {
      const result = await resolveIsaidubChain(urlParam, siteBase);
      return NextResponse.json({ items: [], ...result });
    }

    // Scrape the page for sub-items
    const fullUrl = urlParam.startsWith("http")
      ? urlParam
      : `${siteBase}${urlParam}`;
    const html = await fetchHtml(fullUrl, siteBase);

    const items = extractSubItems(html, urlParam, site);

    // If items contain download page links, auto-resolve them all
    const downloadItems = items.filter(
      (i) =>
        (site === "moviesda" && /^\/download\//.test(i.url)) ||
        (site === "isaidub" && /^\/download\/page\//.test(i.url))
    );

    if (downloadItems.length > 0) {
      const allServerLinks: { name: string; url: string }[] = [];
      const allWatchLinks: { name: string; url: string }[] = [];

      await Promise.all(
        downloadItems.map(async (item) => {
          try {
            let resolved: {
              serverLinks: { name: string; url: string }[];
              watchLinks: { name: string; url: string }[];
            };
            if (site === "moviesda") {
              resolved = await resolveMoviesdaChain(item.url, siteBase);
            } else {
              resolved = await resolveIsaidubChain(item.url, siteBase);
            }
            // Tag each link with the file name for clarity
            for (const l of resolved.serverLinks) {
              allServerLinks.push({
                name: `${item.name} — ${l.name}`,
                url: l.url,
              });
            }
            for (const l of resolved.watchLinks) {
              allWatchLinks.push({
                name: `${item.name} — ${l.name}`,
                url: l.url,
              });
            }
          } catch (e) {
            console.error("resolve error", e);
          }
        })
      );

      if (allServerLinks.length > 0 || allWatchLinks.length > 0) {
        return NextResponse.json({
          items: items.filter(
            (i) =>
              !(site === "moviesda" && /^\/download\//.test(i.url)) &&
              !(site === "isaidub" && /^\/download\/page\//.test(i.url))
          ),
          serverLinks: allServerLinks,
          watchLinks: allWatchLinks,
        });
      }
    }

    return NextResponse.json({ items, serverLinks: [], watchLinks: [] });
  } catch (err) {
    console.error("Details error:", err);
    return NextResponse.json({ items: [], serverLinks: [], watchLinks: [] });
  }
}
