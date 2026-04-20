import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get("url") || "https://animesalt.ac/";
    
  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    let html = await response.text();

    // CSS to hide AnimeSalt branding and add custom styling
    const customCSS = `
      <style>
        /* Hide AnimeSalt logos and watermarks */
        img[alt*="AnimeSalt"],
        img[alt*="anime salt"],
        .logo img,
        .site-logo,
        .header-logo,
        [class*="anime-salt"],
        [class*="animesalt"],
        .watermark,
        [class*="watermark"],
        footer .logo,
        .footer-logo,
        .branding {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }

        /* Add p.s movizs logo in header */
        header::after,
        .header::after,
        nav::after,
        .navbar::after {
          content: '';
          position: absolute;
          top: 10px;
          left: 20px;
          width: 120px;
          height: 40px;
          background: url('https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/edc22665-6f69-41bf-966e-691d920b92da/WhatsApp_Image_2026-01-27_at_10.41.17_PM-removebg-preview-1769562285410.png?width=8000&height=8000&resize=contain') no-repeat center;
          background-size: contain;
          z-index: 9999;
          pointer-events: none;
        }

        /* Add watermark in bottom right */
        body::after {
          content: 'p.s movizs';
          position: fixed;
          bottom: 20px;
          right: 20px;
          font-size: 14px;
          font-weight: 900;
          color: rgba(220, 38, 38, 0.6);
          text-transform: uppercase;
          letter-spacing: 2px;
          z-index: 9999;
          pointer-events: none;
          text-shadow: 0 0 10px rgba(220, 38, 38, 0.4);
        }

        /* Hide ad popups and overlays */
        .popup,
        .modal,
        [class*="ad-overlay"],
        [class*="popup"],
        [class*="modal"] {
          display: none !important;
        }
      </style>
    `;

    // JavaScript to block ad redirects and popups
    const customJS = `
      <script>
        (function() {
          // Block window.open (prevents new tab redirects)
          window.open = function() { 
            console.log('Blocked: window.open');
            return null; 
          };

          // Block all external link clicks
          document.addEventListener('click', function(e) {
            const target = e.target.closest('a');
            if (target && target.href && target.target === '_blank') {
              e.preventDefault();
              e.stopPropagation();
              console.log('Blocked: external link');
              return false;
            }
          }, true);

          // Prevent video click redirects
          document.addEventListener('DOMContentLoaded', function() {
            const checkAndProtect = setInterval(function() {
              const videos = document.querySelectorAll('video, .video-player, .jwplayer, #player');
              videos.forEach(function(video) {
                video.style.pointerEvents = 'auto';
                video.addEventListener('click', function(e) {
                  e.stopPropagation();
                }, true);
              });
            }, 1000);

            // Stop checking after 10 seconds
            setTimeout(function() {
              clearInterval(checkAndProtect);
            }, 10000);
          });

          // Remove ad overlays dynamically
          const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
              if (mutation.addedNodes) {
                mutation.addedNodes.forEach(function(node) {
                  if (node.nodeType === 1) {
                    const className = node.className || '';
                    const id = node.id || '';
                    if (className.includes('ad') || 
                        className.includes('popup') || 
                        className.includes('overlay') ||
                        id.includes('ad') ||
                        id.includes('popup')) {
                      node.style.display = 'none';
                    }
                  }
                });
              }
            });
          });

          setTimeout(function() {
            observer.observe(document.body, {
              childList: true,
              subtree: true
            });
          }, 1000);
        })();
      </script>
    `;

    // Inject CSS and JS before </head>
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${customCSS}${customJS}</head>`);
    } else {
      html = `${customCSS}${customJS}${html}`;
    }

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
}
