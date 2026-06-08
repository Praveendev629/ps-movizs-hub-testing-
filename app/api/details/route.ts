import { NextRequest, NextResponse } from "next/server";

const SITES: Record<string, string> = {
  moviesda: "https://moviesda31.com",
  isaidub: "https://isaidub.guru",
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
 * Moviesda31.com download chain:
 * /download/slug/ → download.moviespage.xyz/download/file/ID → movies.downloadpage.xyz/download/page/ID
 * Final page has: CDN links + play.onestream.today/stream/page/ID watch links
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

  // Extract CDN download links (cdn.uptomkv.ch or similar)
  const dlLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:cdn|s\d+)\.[^"]+)"[^>]*>(Download[^<]+)/gi
  );

  // Extract watch online links — moviesda uses play.onestream.today/stream/page/ID
  const watchLinksRaw = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:play|stream|watch|online|video)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log("Moviesda - raw watch links:", watchLinksRaw.length);
  watchLinksRaw.forEach((l, i) => console.log(`  ${i+1}. ${l.name}: ${l.url}`));

  // Convert play.onestream.today links to stream-resolve API calls
  const watchLinks = watchLinksRaw.map(link => {
    if (link.url.includes("onestream.today") || link.url.includes("uptomkv.ch") || link.url.includes("uptodub.ch")) {
      return {
        name: link.name || "Watch Online",
        url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`,
      };
    }
    return link;
  });

  // De-duplicate
  const uniqueWatch = watchLinks.filter((link, idx, self) =>
    idx === self.findIndex(l => l.url === link.url)
  );

  console.log("Moviesda - final watch links:", uniqueWatch.length);

  if (dlLinks.length === 0) {
    // Broader fallback
    const allLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/[^"#]+)"[^>]*>\s*((?:Download|Watch|Stream|Play|Online|Video|Now)[^<]+)/gi
    );
    const dl = allLinks.filter(l => l.name.toLowerCase().includes("download"));
    const wl = allLinks
      .filter(l => {
        const n = l.name.toLowerCase();
        const u = l.url.toLowerCase();
        return n.includes("watch") || n.includes("stream") || n.includes("play") || n.includes("online") || u.includes("onestream") || u.includes("uptomkv");
      })
      .map(link => ({
        name: link.name || "Watch Online",
        url: link.url.includes("onestream.today") || link.url.includes("uptomkv")
          ? `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
          : link.url,
      }));
    return { serverLinks: dl, watchLinks: wl };
  }

  return { serverLinks: dlLinks, watchLinks: uniqueWatch };
}

/**
 * Isaidub.guru download chain:
 * /download/page/ID/ → dubpage.xyz/download/view/ID → dubmv.xyz/download/file/ID
 * Final page has: CDN links (dub.uptodub.ch) + dub.onestream.today/stream/video/ID watch links
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
    // Step 2: dubmv.xyz (updated from dubmv.top)
    const step2 = extractHrefLinks(
      html2,
      /href="(https?:\/\/dubmv\.xyz\/download\/file\/\d+)"[^>]*>([^<]+)/gi
    );
    if (step2.length > 0) {
      html3 = await fetchHtml(step2[0].url, step1[0].url);
    } else {
      // Try legacy dubmv.top as fallback
      const step2b = extractHrefLinks(
        html2,
        /href="(https?:\/\/dubmv\.top\/download\/file\/\d+)"[^>]*>([^<]+)/gi
      );
      if (step2b.length > 0) {
        html3 = await fetchHtml(step2b[0].url, step1[0].url);
      } else {
        html3 = html2;
      }
    }
  } else {
    html3 = html1;
  }

  // Extract CDN download links (dub.uptodub.ch or dub.dubshare.*)
  const dlLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:dub\.uptodub\.[^"]+|s\d+\.dubshare\.[^"]+))"[^>]*>(Download[^<]+)/gi
  );

  // Extract watch links — isaidub uses dub.onestream.today/stream/video/ID
  const watchLinksRaw = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:dub\.onestream\.today|stream|watch|play)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  console.log("Isaidub - raw watch links:", watchLinksRaw.length);
  watchLinksRaw.forEach((l, i) => console.log(`  ${i+1}. ${l.name}: ${l.url}`));

  // Convert to stream-resolve API calls
  const watchLinks = watchLinksRaw.map(link => {
    if (link.url.includes("onestream.today") || link.url.includes("uptodub.ch") || link.url.includes("dubshare")) {
      return {
        name: link.name || "Watch Online",
        url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`,
      };
    }
    return link;
  });

  const uniqueWatch = watchLinks.filter((link, idx, self) =>
    idx === self.findIndex(l => l.url === link.url)
  );

  console.log("Isaidub - final watch links:", uniqueWatch.length);

  if (dlLinks.length === 0) {
    const allLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/[^"#]+)"[^>]*>\s*((?:Download|Watch|Stream|Play|Online|Video|Now)[^<]+)/gi
    );
    const dl = allLinks.filter(l => l.name.toLowerCase().includes("download"));
    const wl = allLinks
      .filter(l => {
        const n = l.name.toLowerCase();
        const u = l.url.toLowerCase();
        return n.includes("watch") || n.includes("stream") || n.includes("play") || n.includes("online") || u.includes("onestream") || u.includes("uptodub");
      })
      .map(link => ({
        name: link.name || "Watch Online",
        url: link.url.includes("onestream.today") || link.url.includes("uptodub")
          ? `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
          : link.url,
      }));
    return { serverLinks: dl, watchLinks: wl };
  }

  return { serverLinks: dlLinks, watchLinks: uniqueWatch };
}

/**
 * Extract sub-navigation items from a movie/anime detail page.
 */
function extractSubItems(
  html: string,
  pageUrl: string,
  site: string
): { name: string; url: string }[] {
  const items: { name: string; url: string }[] = [];

  if (site === "animesalt") {
    const cleanHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "");

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

  // Method 2: internal links that are sub-pages
  const allLinkRe =
    /<a[^>]+href="(\/[^"?#]+)"[^>]*>([^<]+)<\/a>/gi;

  const skipTexts = new Set([
    "Home", "Contact Us", "DMCA", "Download Now", "Go to Home",
    "SMS", "Facebook", "Twitter", "Whatsapp", "Telegram Channel",
    "Facebook Fan Page", "Telegram Update Page",
    "A","B","C","D","E","F","G","H","I","J","K","L","M",
    "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  ]);

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

/** Scrape movie poster from the source site page */
async function scrapeSitePoster(movieUrl: string, siteBase: string): Promise<string | null> {
  try {
    const fullUrl = movieUrl.startsWith("http") ? movieUrl : `${siteBase}${movieUrl}`;
    const html = await fetchHtml(fullUrl, siteBase);
    
    // Look for poster image: /uploads/posters/slug.webp or .jpg
    const posterMatch = html.match(/<(?:source|img)[^>]+srcset="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i)
      || html.match(/<img[^>]+src="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i);
    
    if (posterMatch && posterMatch[1]) {
      const posterPath = posterMatch[1];
      return posterPath.startsWith("http") ? posterPath : `${siteBase}${posterPath}`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url") || "";
  const site = req.nextUrl.searchParams.get("site") || "moviesda";
  const siteBase = SITES[site] || SITES.moviesda;
  const posterOnly = req.nextUrl.searchParams.get("posterOnly") === "1";

  if (!urlParam)
    return NextResponse.json({ items: [], serverLinks: [], watchLinks: [], poster: null });

  // If only requesting poster from source site
  if (posterOnly) {
    const poster = await scrapeSitePoster(urlParam, siteBase);
    return NextResponse.json({ poster });
  }

  try {
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

    // Also try to extract poster from this page
    let poster: string | null = null;
    const posterMatch = html.match(/<(?:source|img)[^>]+srcset="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i)
      || html.match(/<img[^>]+src="([^"]*\/uploads\/posters\/[^"]+\.(?:webp|jpg|jpeg|png))"[^>]*>/i);
    if (posterMatch && posterMatch[1]) {
      const p = posterMatch[1];
      poster = p.startsWith("http") ? p : `${siteBase}${p}`;
    }

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
          poster,
        });
      }
    }

    return NextResponse.json({ items, serverLinks: [], watchLinks: [], poster });
  } catch (err) {
    console.error("Details error:", err);
    return NextResponse.json({ items: [], serverLinks: [], watchLinks: [], poster: null });
  }
}
