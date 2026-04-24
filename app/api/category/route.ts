import { NextRequest, NextResponse } from "next/server";

const SITES: Record<string, string> = {
  moviesda: "https://moviesda19.com",
  isaidub: "https://isaidub.love",
  animesalt: "https://animesalt.ac",
};
    
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://isaidub.love/",
  "DNT": "1",
};

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 1800 },
  });
  return res.text();
}

/** Extract letter links (A-Z) from an A-Z index page */
function extractLetterLinks(html: string): { title: string; url: string }[] {
  const letters: { title: string; url: string }[] = [];
  
  // Match letter links - handle both direct text and <font> wrapped text
  // Example: <a href="/path/a"><font>A</font></a> or <a href="/path/a">A</a>
  const re = /<a[^>]*href="([^"]*\/[a-z])(?:\/)?[^"]*"[^>]*>(?:<[^>]*>)*([A-Z])(?:<\/[^>]*>)*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1]; // href without the trailing slash
    const letter = m[2]; // The letter itself
    
    if (/^[A-Z]$/.test(letter)) {
      const normalized = url.replace(/\/+$/, "");
      if (!letters.find(l => l.url === normalized)) {
        letters.push({ title: letter, url: normalized });
      }
    }
  }
  
  // If the above regex didn't work, try a simpler approach
  if (letters.length === 0) {
    const simpleRe = /<a\s+href="([^"]*\/[a-z]\/?)"[^>]*>[\s\S]*?([A-Z])[\s\S]*?<\/a>/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = simpleRe.exec(html)) !== null) {
      const url = m2[1].replace(/\/+$/, "");
      const letter = m2[2];
      if (/^[A-Z]$/.test(letter) && !letters.find(l => l.url === url)) {
        letters.push({ title: letter, url });
      }
    }
  }
  
  console.log(`extractLetterLinks: Found ${letters.length} letters`);
  if (letters.length > 0) {
    console.log(`Sample letters: ${letters.slice(0, 3).map(l => `${l.title}(${l.url})`).join(", ")}`);
  }
  
  return letters;
}




/** Check if a page is a pure A-Z index (only letter links, no real movie links) */
function hasMovieAnchors(html: string): boolean {
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let count = 0;

  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]*>/g, "").trim();
    if (!text || text.length < 3) continue;
    const lowerText = text.toLowerCase();
    if (["next", "prev", "previous", "home", "contact", "category", "read more", "more", "watch now", "download"].includes(lowerText)) continue;
    if (/^[a-z]$/.test(text)) continue;
    if (href.includes("atoz") || href.match(/\/([a-z])$/i)) continue;
    if (href.includes(".jpg") || href.includes(".png") || href.includes(".gif") || href.includes(".mp4") || href.includes(".zip")) continue;

    if (href.startsWith("http") && !href.includes("isaidub.love") && !href.includes("moviesda18.com")) continue;
    if (href.startsWith("/") || href.includes("/movie/") || href.includes("-movies") || href.includes("/tamil-")) {
      count += 1;
      if (count > 4) return true;
    }
  }

  return count > 4;
}

function isAtoZIndex(html: string, url: string): boolean {
  const letters = extractLetterLinks(html);
  if (letters.length === 0) return false;

  const lowerUrl = url.toLowerCase();
  const urlIndicatesAtoZ = /atoz|a\s*[-to]*\s*z|a-z/.test(lowerUrl);
  const pageIndicatesAtoZ = /a\s*[-to]*\s*z/i.test(html);

  if (urlIndicatesAtoZ || pageIndicatesAtoZ) {
    return !hasMovieAnchors(html);
  }

  // Only treat as A-Z if there are no movie-like anchor links.
  return !hasMovieAnchors(html);
}

/** Detect total pages from HTML */
function getLastPage(html: string, site: string): number {
  let max = 1;
  
  // For isaidub, look for pagination with get-page parameter
  if (site === "isaidub") {
    // Pattern: ?get-page=14 or similar
    const re1 = /\?get-page=(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re1.exec(html)) !== null) {
      const n = parseInt(m[1]);
      if (n > max) max = n;
    }
    
    // Also look for pagination patterns like "Page 1 of 14"
    const re2 = /(?:Page\s+\d+\s+of\s+|showing\s+\d+\s+of\s+)(\d+)/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(html)) !== null) {
      const n = parseInt(m2[1]);
      if (n > max) max = n;
    }

    // Also detect letter page pagination links like /a/2, /b/3, etc.
    const re3 = /href="[^"]*\/([a-zA-Z])\/(\d+)(?:\/|")/gi;
    let m3: RegExpExecArray | null;
    while ((m3 = re3.exec(html)) !== null) {
      const n = parseInt(m3[2]);
      if (n > max) max = n;
    }
    
    console.log(`getLastPage detected: ${max} for isaidub`);
    return max;
  }
  
  // For moviesda
  const queryRe = /\?page=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = queryRe.exec(html)) !== null) {
    const n = parseInt(m[1]);
    if (n > max) max = n;
  }

  const pathRe = /href="[^"]*\/page\/(\d+)(?:\/|")/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = pathRe.exec(html)) !== null) {
    const n = parseInt(m2[1]);
    if (n > max) max = n;
  }

  const letterPathRe = /href="[^"]*\/[a-zA-Z]\/(\d+)(?:\/|")/gi;
  let m3: RegExpExecArray | null;
  while ((m3 = letterPathRe.exec(html)) !== null) {
    const n = parseInt(m3[1]);
    if (n > max) max = n;
  }

  return max;
}

function usesMoviesdaPathPagination(html: string): boolean {
  return /href="[^"]*\/page\/(\d+)(?:\/|")/gi.test(html) || /href="[^"]*\/[a-zA-Z]\/\d+(?:\/|")/gi.test(html);
}

function isMoviesdaLetterPageUrl(url: string): boolean {
  const cleaned = url.split("?")[0].replace(/\/+$/, "");
  return /(?:atoz|tamil-movies)\/[a-zA-Z](?:\/\?page=\d+)?$/.test(cleaned);
}

function isIsaidubLetterPageUrl(url: string): boolean {
  const cleaned = url.split("?")[0].replace(/\/+$/, "");
  return /atoz\/[a-zA-Z]$/.test(cleaned);
}
/** Extract movie/anime links from a page, filtering out nav/alphabet/pagination links */
function extractMoviesFromPage(
  html: string,
  baseUrl: string,
  site: string
): { title: string; url: string }[] {
  const movies: { title: string; url: string }[] = [];

  // For animesalt, scrape anime cards/links
  if (site === "animesalt") {
    // Try to find anime cards or list items
    const animeSelectors = [
      /<a[^>]+href="([^"]*(?:anime|watch|episode)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    ];

    for (const selector of animeSelectors) {
      let match: RegExpExecArray | null;
      while ((match = selector.exec(html)) !== null) {
        const href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        
        if (!text || text.length < 2) continue;
        if (href.includes(".jpg") || href.includes(".png") || href.includes(".gif")) continue;
        
        // Skip navigation and non-anime links
        if (text.match(/^(home|login|register|search|menu|genre|type|season)/i)) continue;
        
        if (!movies.find(m => m.url === href)) {
          movies.push({ title: text, url: href });
        }
      }
      
      // If we found anime, break the loop
      if (movies.length > 0) break;
    }

    console.log(`animesalt extractMoviesFromPage: Found ${movies.length} anime`);
    return movies;
  }

  // First, try to match div.f structure (isaidub letter pages)
  // Example: <div class="f"> <img .../> <a href="/movie/...">Title</a> </div>
  const divFWrapperRegex = /<div[^>]*class=(?:"|')?[^"'>]*\bf\b[^"'>]*(?:"|')?[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = divFWrapperRegex.exec(html)) !== null) {
    const divContent = match[1];
    const anchorMatch = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(divContent);
    if (!anchorMatch) continue;

    const href = anchorMatch[1].trim();
    const text = anchorMatch[2].replace(/<[^>]*>/g, "").trim();
    if (!text || text.length < 2) continue;

    if (href && href.includes("/movie/")) {
      if (!movies.find(m => m.url === href)) {
        movies.push({ title: text, url: href });
      }
    }
  }
  
  // If this is a moviesda letter page, parse movie item links directly before fallback
  if (site === "moviesda" && /\/tamil-movies\/[a-zA-Z](?:\/\?page=\d+)?$/.test(baseUrl)) {
    // Multiple patterns for moviesda19.com letter pages
    const moviePatterns = [
      // Pattern for movie links with year and format
      /<a[^>]+href="([^"\s]*\/[-a-z0-9]+-\d{4}-tamil-movie(?:\/|$))"[^>]*>([\s\S]*?)<\/a>/gi,
      // Pattern for movie links without year
      /<a[^>]+href="([^"\s]*\/[-a-z0-9]+-tamil-movie(?:\/|$))"[^>]*>([\s\S]*?)<\/a>/gi,
      // Pattern for web series
      /<a[^>]+href="([^"\s]*\/[-a-z0-9]+-\d{4}-tamil-web-series(?:\/|$))"[^>]*>([\s\S]*?)<\/a>/gi,
      // Generic pattern for any movie link
      /<a[^>]+href="([^"\s]*\/[-a-z0-9]+-(?:\d{4}-)?tamil-(?:movie|web-series)(?:\/|$))"[^>]*>([\s\S]*?)<\/a>/gi
    ];
    
    for (const pattern of moviePatterns) {
      let m2: RegExpExecArray | null;
      while ((m2 = pattern.exec(html)) !== null) {
        const href = m2[1].trim();
        const title = m2[2].replace(/<[^>]*>/g, "").trim();
        const lower = title.toLowerCase();
        if (!title || title.length < 3) continue;
        if (lower.includes("collection") || lower.includes("download") || lower.includes("genres") || lower.includes("dubbed")) continue;
        if (href.endsWith("/tamil-movies") || href.includes("tamil-movies-collection")) continue;
        const normalizedHref = href.startsWith("http") ? href : href.replace(/\/+/g, "/");
        if (!movies.find(m => m.url === normalizedHref)) {
          movies.push({ title, url: normalizedHref });
        }
      }
    }
  }

  // If div.f or moviesda direct parse didn't find movies, try the generic approach
  if (movies.length === 0) {
    // Remove navigation, headers, footers, nav sections
    let cleanHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<div[^>]*class="[^"]*(?:alpha|letter|alphabet|pagination|nav|breadcrumb|pagecontent)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

    // Extract all anchor tags with their href and text
    const linkRegex = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match2: RegExpExecArray | null;

    const candidates: { url: string; title: string }[] = [];
    
    while ((match2 = linkRegex.exec(cleanHtml)) !== null) {
      const href = match2[1].trim();
      const text = match2[2].replace(/<[^>]*>/g, "").trim();

      // Basic filters
      if (!text || text.length < 2) continue;
      if (!href || href === "/" || href === "#") continue;

      // Skip obvious non-movie links
      if (/^[A-Z]$/.test(text)) continue; // Single letters
      if (/^\d+$/.test(text)) continue; // Page numbers
      if (["»", "«", "Next", "Prev", "Previous", "Home", "Contact", "Category"].includes(text)) continue;
      if (href.includes("?")) continue; // Pagination links
      if (href.includes("facebook.com") || href.includes("twitter.com") || href.includes("telegram")) continue;

      candidates.push({ url: href, title: text });
    }

    // Filter candidates to keep only movie/anime-like URLs
    const movieCandidates = candidates.filter(c => {
      const url = c.url.toLowerCase();
      const text = c.title;
      const hasYear = /\(\d{4}\)/.test(text);
      
      const isMovieUrl = url.includes("/movie/") || url.includes("/series/") || /-(?:movie|moviesda)(?:\/|$)/i.test(url);
      const isInternal = url.startsWith("/") || url.includes("moviesda18.com") || url.includes("animesalt.ac");
      const isLetterOrPage = !!url.match(/\/[a-z]([\/#]|$)/) || !!url.match(/\/page\/(\d+)/);
      const isNotIndex = !isLetterOrPage;
      
      if (site === "moviesda") {
        return isInternal && isNotIndex && (isMovieUrl || hasYear || url.includes("tamil-movies") || url.includes("moviesda18.com/tamil-movies"));
      }

      if (site === "animesalt") {
        const hasAnimeContext = url.match(/anime|episode|watch/i);
        return (isMovieUrl || hasAnimeContext) && isNotIndex;
      }

      const hasMovieContext = url.match(/movie|series|dubbed/i);
      return (isMovieUrl || hasMovieContext) && isNotIndex;
    });

    // Remove duplicates and add to result
    for (const candidate of movieCandidates) {
      if (!movies.find(m => m.url === candidate.url)) {
        movies.push({ title: candidate.title, url: candidate.url });
      }
    }
  }

  if (movies.length > 0) {
    console.log(`extractMoviesFromPage: Found ${movies.length} movies`);
  }
  
  return movies;
}




export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const site = req.nextUrl.searchParams.get("site") || "moviesda";
  const siteBase = SITES[site] || SITES.moviesda;

  if (!url) return NextResponse.json([]);

  try {
    const pageParam = site === "isaidub" ? "get-page" : "page";
    let fullUrl = url.startsWith("http") ? url : `${siteBase}${url}`;
    if (site === "isaidub" && isIsaidubLetterPageUrl(url)) {
      fullUrl = fullUrl.replace(/\/+$/, "");
    }

    // Fetch first page
    const firstHtml = await fetchPage(fullUrl);

    // Check if this is a pure A-Z index page
    const letters = extractLetterLinks(firstHtml);
    const isAtoZ = isAtoZIndex(firstHtml, url);

    if (isAtoZ) {
      console.log("Detected A-Z index page");
      return NextResponse.json(letters);
    }

    // Extract movies from first page
    let allMovies = extractMoviesFromPage(firstHtml, fullUrl, site);
    console.log(`First page: ${allMovies.length} movies`);

    // Get pagination info
    const lastPage = getLastPage(firstHtml, site);
    const isMoviesdaLetterPage = site === "moviesda" && isMoviesdaLetterPageUrl(url);
    const isAnimesaltPage = site === "animesalt";
    const pageMode = site === "moviesda"
      ? (usesMoviesdaPathPagination(firstHtml) ? "path" : "query")
      : "query";
    // For isaidub, allow up to 50 pages; for moviesda, cap at 30; for animesalt, cap at 20
    const maxPages = site === "isaidub" ? Math.min(lastPage, 50) : site === "animesalt" ? Math.min(lastPage, 20) : Math.min(lastPage, 30);
    console.log(`URL: ${fullUrl}`);
    console.log(`Last page detected: ${lastPage}, page mode: ${pageMode}`);

    if (maxPages > 1) {
      console.log(`Fetching pages 2-${maxPages}...`);
      const pagePromises: Promise<string>[] = [];
      const isIsaidubLetterPage = site === "isaidub" && isIsaidubLetterPageUrl(url);
      const basePageUrl = fullUrl.replace(/\/$/, "");

      for (let p = 2; p <= maxPages; p++) {
        let pageUrl: string;
        if (isIsaidubLetterPage) {
          pageUrl = `${basePageUrl}/${p}`;
        } else if (isMoviesdaLetterPage) {
          const sep = fullUrl.includes("?") ? "&" : "?";
          pageUrl = `${fullUrl}${sep}page=${p}`;
        } else if (isAnimesaltPage) {
          const sep = fullUrl.includes("?") ? "&" : "?";
          pageUrl = `${fullUrl}${sep}page=${p}`;
        } else if (site === "moviesda" && pageMode === "path") {
          pageUrl = `${basePageUrl}/page/${p}/`;
        } else {
          const sep = fullUrl.includes("?") ? "&" : "?";
          pageUrl = `${fullUrl}${sep}${site === "isaidub" ? "get-page" : "page"}=${p}`;
        }
        console.log(`Queueing page ${p}: ${pageUrl}`);
        pagePromises.push(fetchPage(pageUrl).catch(err => {
          console.log(`Error fetching page ${p}: ${err}`);
          return ""; // Return empty on error
        }));
      }
      const results = await Promise.allSettled(pagePromises);
      let successCount = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value) {
          const more = extractMoviesFromPage(result.value, fullUrl, site);
          console.log(`Page ${i + 2}: ${more.length} movies`);
          if (more.length > 0) successCount++;
          for (const mv of more) {
            if (!allMovies.find((m) => m.url === mv.url)) {
              allMovies.push(mv);
            }
          }
        }
      }
      console.log(`Successfully fetched ${successCount}/${maxPages - 1} additional pages`);
    }

    console.log(`Final total: ${allMovies.length} movies`);
    return NextResponse.json(allMovies);
  } catch (err) {
    console.error("Category error:", err);
    return NextResponse.json([]);
  }
}
