/**
 * api/funnel.js
 * Serves published funnel pages.
 *
 * Two access patterns:
 *
 * 1. Direct URL (no custom domain):
 *    /api/funnel?fid=funnel_1234567&uid=abc123
 *
 * 2. Custom domain (via Vercel rewrites):
 *    yourdomain.com/ → serves homePage
 *
 * Domain routing — THREE layers, each a fallback for the previous:
 *   Layer 1: domain-map collection (fast document lookup by domain)
 *   Layer 2: published-funnels query where domain == host (works even if domain-map was never written)
 *   Layer 3: users/{uid}/funnels query where domain == host (last resort)
 *
 * This means a funnel is always found as long as it was published with a domain,
 * regardless of whether verify-domain.js successfully wrote to domain-map.
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

function docData(snap) {
  return snap.data ? snap.data() : snap;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    const { fid, uid, page: pageParam, path: pathParam } = req.query;

    // ── 1. Resolve the funnel ──────────────────────────────────────────────────
    let funnel = null;

    if (fid) {
      // ── Direct access via ?fid= ──
      if (uid) {
        try {
          const snap = await db.collection('users').doc(uid)
            .collection('funnels').doc(fid).get();
          if (snap.exists) funnel = docData(snap);
        } catch(e) {}
      }
      if (!funnel) {
        try {
          const snap = await db.collection('published-funnels').doc(fid).get();
          if (snap.exists) funnel = docData(snap);
        } catch(e) {}
      }

    } else {
      // ── Custom domain access ──
      const host = (req.headers.host || '').toLowerCase()
        .replace(/^www\./, '')
        .replace(/:\d+$/, ''); // strip port if present

      if (!host) {
        return res.status(400).send(notFoundPage('No domain detected.'));
      }

      console.log('[funnel] Custom domain request for host:', host);

      // LAYER 1 — domain-map fast lookup
      try {
        const domainSnap = await db.collection('domain-map').doc(host).get();
        if (domainSnap.exists) {
          const domainData = docData(domainSnap);
          const funnelId   = domainData.funnelId;
          const ownerUid   = domainData.uid;
          console.log('[funnel] domain-map hit — funnelId:', funnelId);
          if (funnelId) {
            if (ownerUid) {
              try {
                const s = await db.collection('users').doc(ownerUid)
                  .collection('funnels').doc(funnelId).get();
                if (s.exists) funnel = docData(s);
              } catch(e) {}
            }
            if (!funnel) {
              try {
                const s = await db.collection('published-funnels').doc(funnelId).get();
                if (s.exists) funnel = docData(s);
              } catch(e) {}
            }
          }
        } else {
          console.log('[funnel] domain-map miss for:', host);
        }
      } catch(e) {
        console.error('[funnel] domain-map error:', e.message);
      }

      // LAYER 2 — query published-funnels directly by domain field
      // This works even if domain-map was never written (e.g. verify step failed)
      if (!funnel) {
        console.log('[funnel] Trying published-funnels query for domain:', host);
        try {
          const q = await db.collection('published-funnels')
            .where('domain', '==', host)
            .limit(1)
            .get();
          if (!q.empty) {
            funnel = docData(q.docs[0]);
            console.log('[funnel] published-funnels query hit — id:', funnel.id);
          }
        } catch(e) {
          console.error('[funnel] published-funnels query error:', e.message);
        }
      }

      // LAYER 3 — try www variant in case domain was stored with www prefix
      if (!funnel) {
        const wwwHost = 'www.' + host;
        console.log('[funnel] Trying www variant:', wwwHost);
        try {
          const q = await db.collection('published-funnels')
            .where('domain', '==', wwwHost)
            .limit(1)
            .get();
          if (!q.empty) {
            funnel = docData(q.docs[0]);
            console.log('[funnel] www variant hit — id:', funnel.id);
          }
        } catch(e) {}
      }

      if (!funnel) {
        console.log('[funnel] All layers failed for host:', host);
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

    const pathMap = {};
    pageOrder.forEach(function(pid) {
      const rawPath = pagePaths[pid];
      if (rawPath !== undefined && rawPath !== null) {
        const norm = rawPath === '' ? '/' : (rawPath.startsWith('/') ? rawPath : '/' + rawPath);
        pathMap[norm] = pid;
      }
    });
    pathMap['/']  = homePage;
    pathMap['']   = homePage;

    let resolvedPageId = null;

    if (pageParam && pages[pageParam]) {
      resolvedPageId = pageParam;
    } else if (pathParam) {
      const normPath = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
      resolvedPageId = pathMap[normPath] || pathMap[normPath.toLowerCase()] || null;
    } else {
      const rawUrl   = req.url || '/';
      const urlPath  = rawUrl.split('?')[0] || '/';
      const normPath = urlPath === '' ? '/' : urlPath;

      if (normPath === '/' || normPath === '') {
        resolvedPageId = homePage;
      } else {
        resolvedPageId = pathMap[normPath] || pathMap[normPath.toLowerCase()] || null;
        if (!resolvedPageId) {
          const stripped = normPath.replace(/\/$/, '');
          resolvedPageId = pathMap[stripped] || pathMap[stripped.toLowerCase()] || null;
        }
        if (!resolvedPageId) {
          const lastSegment = normPath.replace(/^\//, '').split('/').pop();
          if (lastSegment && pages[lastSegment]) resolvedPageId = lastSegment;
        }
      }
    }

    if (!resolvedPageId) resolvedPageId = homePage || pageOrder[0];

    const pageData = pages[resolvedPageId];
    if (!pageData || !pageData.html) {
      return res.status(404).send(notFoundPage('Page not found: ' + resolvedPageId, fid));
    }

    // ── 3. Inject navigation and serve ────────────────────────────────────────
    const baseUrl   = fid ? '/api/funnel?fid=' + fid + (uid ? '&uid=' + uid : '') : '';
    const navScript = buildNavScript(baseUrl, resolvedPageId, pageOrder, pagePaths, funnel.domain);
    const html      = injectIntoHtml(pageData.html, navScript);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Funnel-Page', resolvedPageId);
    res.setHeader('X-Funnel-Id',   funnel.id || fid || '');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[api/funnel] error:', err.message);
    return res.status(500).send(notFoundPage('Server error: ' + err.message));
  }
};

function buildNavScript(baseUrl, currentPageId, pageOrder, pagePaths, domain) {
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
window.__eosFunnel = ${JSON.stringify({ currentPage: currentPageId, pageUrls })};
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('a[href], button[data-page]').forEach(function(el) {
    var target = el.getAttribute('href') || el.getAttribute('data-page') || '';
    if (target && window.__eosFunnel.pageUrls[target]) {
      if (el.tagName === 'A') { el.href = window.__eosFunnel.pageUrls[target]; }
      else { el.addEventListener('click', function() { window.location.href = window.__eosFunnel.pageUrls[target]; }); }
    }
  });
  var pageOrder = ${JSON.stringify(pageOrder)};
  var idx = pageOrder.indexOf('${currentPageId}');
  var nextPage = idx >= 0 && idx < pageOrder.length - 1 ? pageOrder[idx + 1] : null;
  if (nextPage && window.__eosFunnel.pageUrls[nextPage]) {
    document.querySelectorAll('[data-next]').forEach(function(el) {
      el.addEventListener('click', function() { window.location.href = window.__eosFunnel.pageUrls[nextPage]; });
    });
  }
});
</script>`;
}

function injectIntoHtml(html, script) {
  return html.includes('</body>') ? html.replace('</body>', script + '\n</body>') : html + script;
}

function notFoundPage(message, fid) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Page Not Found</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0c0c20;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
    .wrap{max-width:440px;text-align:center}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:22px;font-weight:800;margin-bottom:10px;font-family:Poppins,sans-serif}
    p{font-size:13px;color:rgba(255,255,255,.5);line-height:1.7}
    .code{background:rgba(255,255,255,.06);border-radius:6px;padding:4px 10px;font-family:monospace;font-size:12px;color:rgba(255,255,255,.4);margin-top:12px;display:inline-block}
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
