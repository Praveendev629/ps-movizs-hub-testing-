import { NextRequest, NextResponse } from "next/server";

const SITES: Record<string, string> = {
  moviesda: "https://moviesda19.com",
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
  pattern: RegExp,
  fallbackName = ""
): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const url = m[1];
    const name = (m[2] || fallbackName).replace(/<[^>]+>/g, "").trim();
    if (url && name && !links.find((l) => l.url === url)) {
      links.push({ name, url });
    }
  }
  return links;
}

function dedupeLinks(links: { name: string; url: string }[]) {
  const seen = new Map<string, { name: string; url: string }>();
  const deduped: { name: string; url: string }[] = [];
  
  for (const link of links) {
    // Normalize URL for comparison (remove trailing slashes, lowercase)
    const normalizedUrl = link.url.replace(/\/$/, '').toLowerCase();
    
    if (!seen.has(normalizedUrl)) {
      seen.set(normalizedUrl, link);
      deduped.push(link);
    } else {
      // Keep the more descriptive name if available
      const existing = seen.get(normalizedUrl)!;
      if (link.name.length > existing.name.length && !link.name.includes('Direct stream')) {
        existing.name = link.name;
      }
    }
  }
  
  return deduped;
}

function prioritizeAndLimitLinks(links: { name: string; url: string }[], limit: number = 2) {
  // First filter out sample/trailer content
  const filteredLinks = links.filter(link => {
    const name = link.name.toLowerCase();
    const url = link.url.toLowerCase();
    
    // Exclude sample, trailer, preview, and demo content
    const excludePatterns = [
      'sample', 'trailer', 'preview', 'demo', 'teaser',
      'clip', 'snippet', 'excerpt', 'test', 'intro',
      'opening', 'credits', 'behind the scenes', 'making of'
    ];
    
    const isSampleContent = excludePatterns.some(pattern => 
      name.includes(pattern) || url.includes(pattern)
    );
    
    // Also exclude very small files (likely samples)
    const sizeMatch = name.match(/(\d+)\s*(mb|gb)/i);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      const unit = sizeMatch[2].toLowerCase();
      const sizeInMB = unit === 'gb' ? size * 1024 : size;
      
      // Exclude files smaller than 50MB (likely samples)
      if (sizeInMB < 50) {
        return false;
      }
    }
    
    return !isSampleContent;
  });
  
  // Priority scoring system for remaining links
  const scoredLinks = filteredLinks.map(link => {
    let score = 0;
    const name = link.name.toLowerCase();
    const url = link.url.toLowerCase();
    
    // Prioritize onestream.today links
    if (url.includes('onestream.today')) {
      score += 100;
      if (url.includes('play.onestream.today')) {
        score += 50; // Extra priority for play.onestream.today
      }
    }
    
    // Prioritize links with "Watch Online" in name
    if (name.includes('watch online')) {
      score += 30;
    }
    
    // Prioritize "Server 1" over higher numbers
    if (name.includes('server 1')) {
      score += 20;
    }
    
    // Penalize "Direct stream" links
    if (name.includes('direct stream')) {
      score -= 10;
    }
    
    // Bonus for full movie indicators
    const fullMovieIndicators = [
      'full movie', 'complete movie', 'movie', 'film',
      'original', 'hd', '720p', '1080p', 'bluray', 'web-dl'
    ];
    
    fullMovieIndicators.forEach(indicator => {
      if (name.includes(indicator)) {
        score += 15;
      }
    });
    
    // Prioritize links with better descriptions
    if (link.name.length > 20) {
      score += 5;
    }
    
    // Bonus for larger file sizes (likely full movies)
    const sizeMatch = name.match(/(\d+)\s*(mb|gb)/i);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      const unit = sizeMatch[2].toLowerCase();
      const sizeInMB = unit === 'gb' ? size * 1024 : size;
      
      if (sizeInMB > 500) {
        score += 20; // Large files are likely full movies
      } else if (sizeInMB > 200) {
        score += 10; // Medium files
      }
    }
    
    return { ...link, score };
  });
  
  // Sort by score (descending) and take top links
  scoredLinks.sort((a, b) => b.score - a.score);
  
  return scoredLinks.slice(0, limit).map(({ score, ...link }) => link);
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

  // Check if this is already a movies.downloadpage.xyz URL (step 2)
  if (fullUrl.includes('movies.downloadpage.xyz')) {
    console.log('Direct movies.downloadpage.xyz URL detected, skipping to step 2');
    // This is already step 2, so we can process it directly
    const step2 = extractHrefLinks(
      html1,
      /href="(https?:\/\/dubmv\.top\/download\/file\/\d+)"[^>]*>([^<]+)/gi
    );
    
    let html3 = "";
    if (step2.length > 0) {
      html3 = await fetchHtml(step2[0].url, fullUrl);
    } else {
      html3 = html1;
    }
    
    // Extract CDN download links
    const dlLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/s\d+\.cdnserver\d+\.xyz[^"]+)"[^>]*>([^<]*(?:Download|Server)[^<]*)/gi
    );

    // Extract watch links - look for onestream.today links
    let watchLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/play\.onestream\.today\/stream\/page\/\d+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
    );

    // Also try alternative pattern for onestream
    if (watchLinks.length === 0) {
      watchLinks = extractHrefLinks(
        html3,
        /href="(https?:\/\/stream\.onestream\.today\/stream\/page\/\d+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
      );
    }

    // General pattern for any onestream.today link
    if (watchLinks.length === 0) {
      watchLinks = extractHrefLinks(
        html3,
        /href="(https?:\/\/[^"]*onestream\.today\/[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
      );
    }

    console.log('Direct movies.downloadpage.xyz - Found watch links:', watchLinks.length);
    watchLinks.forEach((link, i) => {
      console.log(`  ${i + 1}. ${link.name}: ${link.url}`);
    });

    // Resolve onestream links
    const resolvedLinks = [];
    for (const link of watchLinks) {
      if (link.url.includes('onestream.today')) {
        resolvedLinks.push({
          name: link.name,
          url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
        });
      } else {
        resolvedLinks.push(link);
      }
    }

    return { serverLinks: dlLinks, watchLinks: resolvedLinks };
  }

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

// Extract watch links - prioritize onestream.today links
  let watchLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/play\.onestream\.today\/stream\/page\/\d+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  // Fallback to other onestream patterns
  if (watchLinks.length === 0) {
    watchLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/(?:play|stream)\.onestream\.today\/[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
    );
  }

  // General streaming patterns
  if (watchLinks.length === 0) {
    watchLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/(?:play|stream|watch|online|video)[^"]+|https?:\/\/[^"]*(?:stream|watch|play|online|video)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
    );
  }

  // Additional patterns from remote version
  const watchSectionLinks = extractHrefLinks(
    html3,
    /Watch Online Links<\/div>[\s\S]*?<div class="download">[\s\S]*?href="(https?:\/\/[^"#]+)"[^>]*>([^<]+)</gi
  );

  const playOnestreamLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/play\.onestream\.today\/stream\/(?:page|video)\/\d+)"[^>]*>([^<]+)</gi,
    "Watch Online"
  );

  console.log('Moviesda - Initial watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  Initial ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Additional extraction for direct video streams that might not have proper text
  const directVideoLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/[^"]*\.(?:mp4|m3u8|webm|mkv)[^"]*)"[^>]*>/gi,
    "Direct stream"
  );

  // Specific pattern for moviesda streaming sites - prioritize play.onestream.today
  const moviesdaStreamLinks2 = extractHrefLinks(
    html3,
    /href="(https?:\/\/play\.onestream\.today\/stream\/page\/\d+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  // Also try other onestream patterns
  if (moviesdaStreamLinks2.length === 0) {
    const additionalLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/(?:download\.moviespage\.xyz\/download\/file\/\d+|movies\.downloadpage\.xyz\/download\/file\/\d+|stream\.onestream\.today\/stream\/page\/\d+))"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
    );
    moviesdaStreamLinks2.push(...additionalLinks);
  }

  console.log('Moviesda - Stream links found:', moviesdaStreamLinks2.length);
  moviesdaStreamLinks2.forEach((link, i) => {
    console.log(`  Stream ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Also try to catch any onestream variations from moviesda
  const onestreamVariations = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:download\.moviespage\.xyz\/download\/file\/\d+|movies\.downloadpage\.xyz\/download\/file\/\d+|play\.onestream\.today\/stream\/page\/\d+|stream\.onestream\.today\/stream\/page\/\d+))"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
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

  // General pattern for any onestream.today URLs (catch-all)
  const generalOnestreamLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/[^"]*onestream\.today\/[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  // If still no links, try without text requirement
  if (generalOnestreamLinks.length === 0) {
    const fallbackLinks = extractHrefLinks(
      html3,
      /href="(https?:\/\/[^"]*onestream\.today\/[^"]+)"[^>]*>/gi
    );
    generalOnestreamLinks.push(...fallbackLinks);
  }

  // Resolve general onestream links
  const resolvedGeneralLinks = [];
  for (const link of generalOnestreamLinks) {
    try {
      if (link.url.includes('onestream.today')) {
        resolvedGeneralLinks.push({
          name: link.name,
          url: `/api/stream-resolve?url=${encodeURIComponent(link.url)}`
        });
      } else {
        resolvedGeneralLinks.push(link);
      }
    } catch (error) {
      console.error('Error resolving general onestream link:', error);
    }
  }

  // Debug logging for each source
  console.log('Moviesda - Link sources:');
  console.log(`  watchLinks: ${watchLinks.length}`);
  console.log(`  watchSectionLinks: ${watchSectionLinks.length}`);
  console.log(`  playOnestreamLinks: ${playOnestreamLinks.length}`);
  console.log(`  resolvedMoviesdaLinks: ${resolvedMoviesdaLinks.length}`);
  console.log(`  onestreamVariations: ${onestreamVariations.length}`);
  console.log(`  directVideoLinks: ${directVideoLinks.length}`);
  console.log(`  streamingLinks: ${streamingLinks.length}`);
  console.log(`  resolvedGeneralLinks: ${resolvedGeneralLinks.length}`);

  // Merge all watch links, removing duplicates
  const allWatchLinks = [
    ...watchLinks,
    ...watchSectionLinks,
    ...playOnestreamLinks,
    ...resolvedMoviesdaLinks,
    ...onestreamVariations,
    ...directVideoLinks,
    ...streamingLinks,
    ...resolvedGeneralLinks,
  ];
  
  console.log(`Moviesda - Total links before dedup: ${allWatchLinks.length}`);
  watchLinks = dedupeLinks(allWatchLinks);

  // Prioritize and limit to only 2 best watch online links
  watchLinks = prioritizeAndLimitLinks(watchLinks, 2);

  // Debug logging for watch links
  console.log('Moviesda - Final watch links (limited to 2):', watchLinks.length);
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

  // Extract watch links directly from the resolved download page.
  let watchLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:dub\.[^"]*stream|stream|watch|play|online|video)[^"]+|https?:\/\/[^"]*(?:stream|watch|play|online|video)[^"]+)"[^>]*>([^<]*(?:Watch|Stream|Play|Online|Video|Now)[^<]*)/gi
  );

  const watchSectionLinks = extractHrefLinks(
    html3,
    /Watch Online Links<\/div>[\s\S]*?<div class="download">[\s\S]*?href="(https?:\/\/[^"#]+)"[^>]*>([^<]+)</gi
  );

  console.log('Isaidub - Initial watch links:', watchLinks.length);
  watchLinks.forEach((link, i) => {
    console.log(`  Initial ${i + 1}. ${link.name}: ${link.url}`);
  });

  // Specific pattern for onestream.today links found in isaidub
  const onestreamLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:dub|play)\.onestream\.today\/stream\/(?:video|page)\/\d+)"[^>]*>([^<]+)</gi,
    "Watch Online"
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
    /href="(https?:\/\/[^"]*\.(?:mp4|m3u8|webm|mkv)[^"]*)"[^>]*>/gi,
    "Direct stream"
  );

  // Additional extraction for streaming domains (specific to isaidub)
  const streamingLinks = extractHrefLinks(
    html3,
    /href="(https?:\/\/(?:[^"]*\.?stream[^"]*|[^"]*\.?play[^"]*|[^"]*\.?watch[^"]*|dub[^"]*|video[^"]*|dubshare[^"]*)[^"]+)"[^>]*>/gi
  );

  // Merge all watch links, removing duplicates
  const allWatchLinks = [
    ...watchLinks,
    ...watchSectionLinks,
    ...resolvedOnestreamLinks,
    ...directVideoLinks,
    ...streamingLinks,
  ];
  watchLinks = dedupeLinks(allWatchLinks);

  // Prioritize and limit to only 2 best watch online links
  watchLinks = prioritizeAndLimitLinks(watchLinks, 2);

  // Debug logging for watch links
  console.log('Isaidub - Final watch links (limited to 2):', watchLinks.length);
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

  console.log('Details API called with:', { urlParam, site, siteBase });

  if (!urlParam)
    return NextResponse.json({ items: [], serverLinks: [], watchLinks: [] });

  try {
    // Detect if this is a download trigger page
    const isMoviesdaDownload =
      site === "moviesda" && (/^\/download\/(page\/)?/.test(urlParam) || urlParam.includes('movies.downloadpage.xyz'));
    const isIsaidubDownload =
      site === "isaidub" && /^\/download\/page\//.test(urlParam);

    console.log('URL detection:', { isMoviesdaDownload, isIsaidubDownload });

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

    // Check if this is a movie page with quality options (for moviesda)
    if (site === "moviesda" && items.length > 0) {
      const hasMovieItems = items.some(item => 
        item.url.includes("-movie/") || item.url.includes("-mp4") || item.url.includes("-hd")
      );
      
      console.log('Movie page detection:', { itemsCount: items.length, hasMovieItems, sampleItem: items[0] });
      
      // DISABLED: Auto-resolution logic - show quality options to users instead
      // Users should be able to choose quality like on the original moviesda site
      /*
      // If this looks like a quality selection page, auto-resolve the first quality option
      if (hasMovieItems) {
        console.log('Detected movie quality page, auto-resolving first quality option');
        
        // Find the first quality option (prefer 720p, then 1080p, then Original, then 360p, then HD, then any)
        const qualityOrder = ["720p", "1080p", "Original", "360p", "HD"];
        let firstQualityItem = null;
        
        for (const quality of qualityOrder) {
          firstQualityItem = items.find(item => 
            (item.url.includes("-movie/") || item.url.includes("-mp4") || item.url.includes("-hd")) && item.name.includes(quality)
          );
          if (firstQualityItem) break;
        }
        
        // If no preferred quality found, take the first movie item
        if (!firstQualityItem) {
          firstQualityItem = items.find(item => 
            item.url.includes("-movie/") || item.url.includes("-mp4") || item.url.includes("-hd")
          );
        }
        
        if (firstQualityItem) {
          console.log('Auto-resolving quality:', firstQualityItem.name);
          
          try {
            // Fetch the quality page to get download/watch links
            const qualityUrl = firstQualityItem.url.startsWith("http") 
              ? firstQualityItem.url 
              : `${siteBase}${firstQualityItem.url}`;
            
            const qualityHtml = await fetchHtml(qualityUrl, siteBase);
            const qualityItems = extractSubItems(qualityHtml, firstQualityItem.url, site);
            
            // Look for download items in the quality page
            const downloadItems = qualityItems.filter(
              (i) => /^\/download\//.test(i.url) || i.url.includes('movies.downloadpage.xyz')
            );
            
            if (downloadItems.length > 0) {
              console.log('Found download items in quality page, resolving...');
              
              const allServerLinks: { name: string; url: string }[] = [];
              const allWatchLinks: { name: string; url: string }[] = [];

              await Promise.all(
                downloadItems.map(async (item) => {
                  try {
                    const resolved = await resolveMoviesdaChain(item.url, siteBase);
                    
                    for (const l of resolved.serverLinks) {
                      allServerLinks.push({
                        name: `${firstQualityItem.name} — ${l.name}`,
                        url: l.url,
                      });
                    }
                    for (const l of resolved.watchLinks) {
                      allWatchLinks.push({
                        name: `${firstQualityItem.name} — ${l.name}`,
                        url: l.url,
                      });
                    }
                  } catch (e) {
                    console.error("resolve error for quality item", e);
                  }
                })
              );
              
              // Return the quality options along with resolved download/watch links
              return NextResponse.json({ 
                items, 
                serverLinks: allServerLinks, 
                watchLinks: allWatchLinks 
              });
            }
          } catch (error) {
            console.error('Error auto-resolving quality:', error);
            // Fall back to normal behavior if auto-resolution fails
          }
        }
      }
      */
    }

    // Re-enabled: Auto-resolution for download items only (not quality selection)
    // Users choose quality first, then download items get resolved automatically
    const downloadItems = items.filter(
      (i) =>
        (site === "moviesda" && /^\/download\//.test(i.url)) ||
        (site === "isaidub" && /^\/download\/page\//.test(i.url))
    );

    console.log(`Download items detection: found ${downloadItems.length} download items from ${items.length} total items`);
    console.log('Download items:', downloadItems);

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
