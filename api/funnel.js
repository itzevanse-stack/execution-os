/**
 * api/funnel.js
 * Serves published funnel pages.
 *
 * Two access patterns:
 *
 * 1. Direct URL (no custom domain):
 *    /api/funnel?fid=funnel_1234567&uid=abc123
 *    /api/funnel?fid=funnel_1234567&uid=abc123&page=thankyou
 *
 * 2. Custom domain (via Vercel rewrites):
 *    yourdomain.com/          → serves homePage
 *    yourdomain.com/thank-you → serves page whose pagePaths value is '/thank-you'
 *
 * Domain routing works because verify-domain.js adds the domain to the
 * Firestore 'domain-map' collection: { domain, funnelId, uid }
 * This endpoint reads that mapping and serves the correct page.
 *
 * Page resolution order:
 * 1. If ?page=pageId is in query  → serve that page directly
 * 2. If ?path=/some-path → match against funnel.pagePaths
 * 3. If no path / path is '/'     → serve funnel.homePage
 * 4. Match request path against funnel.pagePaths values
 * 5. Fallback to first page in funnel.pageOrder
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

function initFirebase() {
  if (getApps().length) return getFirestore();
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
  return getFirestore();
}

module.exports = async function handler(req, res) {
  // CORS for iframe embedding and direct access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    const { fid, uid, page: pageParam, path: pathParam } = req.query;

    // ── 1. Resolve the funnel ──────────────────────────────────────────────────
    let funnel = null;

    if (fid) {
      // Direct access via funnel ID
      if (uid) {
        // Try user's own collection first
        try {
          const snap = await db.collection('users').doc(uid)
            .collection('funnels').doc(fid).get();
          if (snap.exists) funnel = snap.data ? snap.data() : snap;
        } catch(e) {}
      }
      // Fallback to published-funnels (public collection set during publish)
      if (!funnel) {
        try {
          const snap = await db.collection('published-funnels').doc(fid).get();
          if (snap.exists) funnel = snap.data ? snap.data() : snap;
        } catch(e) {}
      }
    } else {
      // Custom domain access — resolve via domain-map
      const host = (req.headers.host || '').toLowerCase().replace(/^www\./, '');
      if (host) {
        try {
          const domainSnap = await db.collection('domain-map').doc(host).get();
          if (domainSnap.exists) {
            const domainData = domainSnap.data ? domainSnap.data() : domainSnap;
            const funnelId   = domainData.funnelId;
            const ownerUid   = domainData.uid;
            if (funnelId) {
              // Try user's collection first
              if (ownerUid) {
                try {
                  const s = await db.collection('users').doc(ownerUid)
                    .collection('funnels').doc(funnelId).get();
                  if (s.exists) funnel = s.data ? s.data() : s;
                } catch(e) {}
              }
              // Fallback to published-funnels
              if (!funnel) {
                try {
                  const s = await db.collection('published-funnels').doc(funnelId).get();
                  if (s.exists) funnel = s.data ? s.data() : s;
                } catch(e) {}
              }
            }
          }
        } catch(e) {
          console.error('[funnel] domain-map lookup error:', e.message);
        }
      }
    }

    if (!funnel) {
      return res.status(404).send(notFoundPage('Funnel not found', fid));
    }

    if (funnel.status !== 'live') {
      return res.status(403).send(notFoundPage('This funnel is not published yet.', fid));
    }

    // ── 2. Resolve the correct page ────────────────────────────────────────────
    const pages      = funnel.pages      || {};
    const pageOrder  = funnel.pageOrder  || Object.keys(pages);
    const pagePaths  = funnel.pagePaths  || {};
    const homePage   = funnel.homePage   || pageOrder[0];

    // Build reverse map: path → pageId
    // Normalise paths: ensure each starts with '/'
    const pathMap = {};
    pageOrder.forEach(function(pid) {
      const rawPath = pagePaths[pid];
      if (rawPath !== undefined && rawPath !== null) {
        const norm = rawPath === '' ? '/' : (rawPath.startsWith('/') ? rawPath : '/' + rawPath);
        pathMap[norm] = pid;
      }
    });
    // Always map '/' and '' to homePage
    pathMap['/']  = homePage;
    pathMap['']   = homePage;

    let resolvedPageId = null;

    // Priority 1: explicit ?page=pageId query param
    if (pageParam && pages[pageParam]) {
      resolvedPageId = pageParam;

    // Priority 2: explicit ?path=/some-path query param
    } else if (pathParam) {
      const normPath = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
      resolvedPageId = pathMap[normPath] || pathMap[normPath.toLowerCase()] || null;

    // Priority 3: URL path from the request itself (custom domain routing)
    } else {
      // req.url might be '/thank-you' or '/?fid=...'
      const rawUrl  = req.url || '/';
      const urlPath = rawUrl.split('?')[0] || '/';
      const normPath = urlPath === '' ? '/' : urlPath;

      if (normPath === '/' || normPath === '') {
        resolvedPageId = homePage;
      } else {
        // Exact match
        resolvedPageId = pathMap[normPath] || pathMap[normPath.toLowerCase()] || null;

        // Fuzzy match: strip trailing slash
        if (!resolvedPageId) {
          const stripped = normPath.replace(/\/$/, '');
          resolvedPageId = pathMap[stripped] || pathMap[stripped.toLowerCase()] || null;
        }

        // Match by pageId directly in the URL path
        if (!resolvedPageId) {
          const pathParts = normPath.replace(/^\//, '').split('/');
          const lastSegment = pathParts[pathParts.length - 1];
          if (lastSegment && pages[lastSegment]) {
            resolvedPageId = lastSegment;
          }
        }
      }
    }

    // Final fallback: serve home page
    if (!resolvedPageId) {
      resolvedPageId = homePage || pageOrder[0];
    }

    const pageData = pages[resolvedPageId];
    if (!pageData || !pageData.html) {
      return res.status(404).send(notFoundPage(
        'Page not found: ' + resolvedPageId,
        fid
      ));
    }

    // ── 3. Inject navigation helpers and tracking pixel ───────────────────────
    // Inject inter-page navigation so links between funnel pages work correctly
    const baseUrl = fid
      ? '/api/funnel?fid=' + fid + (uid ? '&uid=' + uid : '')
      : '';

    const navScript = buildNavScript(baseUrl, resolvedPageId, pageOrder, pagePaths, funnel.domain);
    const html = injectIntoHtml(pageData.html, navScript);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Funnel-Page', resolvedPageId);
    res.setHeader('X-Funnel-Id',   funnel.id || fid || '');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[api/funnel] error:', err.message);
    return res.status(500).send(notFoundPage('Server error: ' + err.message));
  }
};

// ── Helper: build navigation script injected into every served page ──────────
function buildNavScript(baseUrl, currentPageId, pageOrder, pagePaths, domain) {
  // Build a map of pageId → full URL so links between pages work
  const pageUrls = {};
  pageOrder.forEach(function(pid) {
    const path = pagePaths[pid] || '/' + pid;
    if (domain) {
      pageUrls[pid] = 'https://' + domain + path;
    } else if (baseUrl) {
      pageUrls[pid] = baseUrl + '&page=' + pid;
    }
  });

  return `
<script>
/* Execution OS Funnel Navigation */
window.__eosFunnel = ${JSON.stringify({ currentPage: currentPageId, pageUrls })};

/* Replace any [PAGE_ID] placeholders in links */
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('a[href], button[data-page]').forEach(function(el) {
    var target = el.getAttribute('href') || el.getAttribute('data-page') || '';
    if (target && window.__eosFunnel.pageUrls[target]) {
      if (el.tagName === 'A') {
        el.href = window.__eosFunnel.pageUrls[target];
      } else {
        el.addEventListener('click', function() {
          window.location.href = window.__eosFunnel.pageUrls[target];
        });
      }
    }
  });
  /* CTA buttons that say "Next" go to the next page in order */
  var pageOrder = ${JSON.stringify(pageOrder)};
  var idx = pageOrder.indexOf('${currentPageId}');
  var nextPage = idx >= 0 && idx < pageOrder.length - 1 ? pageOrder[idx + 1] : null;
  if (nextPage && window.__eosFunnel.pageUrls[nextPage]) {
    document.querySelectorAll('[data-next]').forEach(function(el) {
      el.addEventListener('click', function() {
        window.location.href = window.__eosFunnel.pageUrls[nextPage];
      });
    });
  }
});
</script>`;
}

// ── Helper: inject script before </body> ─────────────────────────────────────
function injectIntoHtml(html, script) {
  if (html.includes('</body>')) {
    return html.replace('</body>', script + '\n</body>');
  }
  return html + script;
}

// ── Helper: friendly error page ──────────────────────────────────────────────
function notFoundPage(message, fid) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Page Not Found</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0c0c20; color:#fff; font-family:Inter,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:2rem; }
    .wrap { max-width:440px; text-align:center; }
    .icon { font-size:48px; margin-bottom:16px; }
    h1 { font-size:22px; font-weight:800; margin-bottom:10px; font-family:Poppins,sans-serif; }
    p { font-size:13px; color:rgba(255,255,255,.5); line-height:1.7; }
    .code { background:rgba(255,255,255,.06); border-radius:6px; padding:4px 10px; font-family:monospace; font-size:12px; color:rgba(255,255,255,.4); margin-top:12px; display:inline-block; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="icon">🔗</div>
    <h1>${message}</h1>
    <p>This page could not be loaded. If you own this funnel, make sure it is published and the domain is correctly connected.</p>
    ${fid ? '<div class="code">Funnel ID: ' + fid + '</div>' : ''}
  </div>
</body>
</html>`;
}
