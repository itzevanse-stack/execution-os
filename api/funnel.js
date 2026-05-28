/**
 * api/funnel.js
 *
 * Serves published funnel pages.
 * Domain resolution — 4 layers, each a fallback for the previous:
 *
 *   Layer 1 — domain-map doc lookup (fastest)
 *   Layer 2 — published-funnels query where domain == host
 *   Layer 3 — published-funnels query where domain == www.host
 *   Layer 4 — scan published-funnels + user funnels for domain match
 *
 * FIX 1: Host detection now reads x-forwarded-host first (Vercel middleware
 *         rewrite sets this to the real custom domain; req.headers.host after
 *         rewrite becomes the internal Vercel hostname — wrong).
 * FIX 2: Layer 1 — if ownerUid is null, still serves from published-funnels
 *         AND falls back to a full-collection domain scan so uid=null funnels
 *         are never silently skipped.
 * FIX 3: Layer 4 — direct domain match on published-funnels catches funnels
 *         with ownerUid:null that the old loop skipped entirely.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

function initFirebase() {
  if (getApps().length) return getFirestore();
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  })});
  return getFirestore();
}

function getData(snap) {
  return snap.data ? snap.data() : snap;
}

// Auto-repair: write to domain-map so next request hits Layer 1
async function repairDomainMap(db, host, funnelId, uid) {
  try {
    const noWww   = host.replace(/^www\./, '');
    const withWww = 'www.' + noWww;
    const record  = { domain: host, funnelId, uid: uid || null, repairedAt: new Date().toISOString() };
    await Promise.all([
      db.collection('domain-map').doc(host).set(record,    { merge: true }),
      db.collection('domain-map').doc(noWww).set({ ...record, domain: noWww },    { merge: true }),
      db.collection('domain-map').doc(withWww).set({ ...record, domain: withWww }, { merge: true }),
    ]);
  } catch(e) {
    console.warn('[funnel] domain-map repair failed:', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    const { fid, uid, page: pageParam, path: pathParam } = req.query;

    let funnel   = null;
    let funnelId = fid || null;
    let ownerUid = uid || null;

    // ── DIRECT ACCESS via ?fid= ───────────────────────────────────────────────
    if (fid) {
      if (uid) {
        try {
          const s = await db.collection('users').doc(uid).collection('funnels').doc(fid).get();
          if (s.exists) funnel = getData(s);
        } catch(e) {}
      }
      if (!funnel) {
        try {
          const s = await db.collection('published-funnels').doc(fid).get();
          if (s.exists) funnel = getData(s);
        } catch(e) {}
      }

    // ── CUSTOM DOMAIN ACCESS ──────────────────────────────────────────────────
    } else {

      // FIX 1 — read x-forwarded-host first.
      // When Vercel middleware rewrites the request to /api/funnel, the
      // original custom domain is preserved in x-forwarded-host while
      // req.headers.host becomes the internal Vercel hostname (wrong).
      const rawHost = (
        req.headers['x-forwarded-host'] ||
        req.headers['x-real-host']      ||
        req.headers.host                ||
        ''
      );
      const host = rawHost.toLowerCase()
        .split(',')[0]          // x-forwarded-host can be comma-separated; take first
        .trim()
        .replace(/^www\./, '')
        .replace(/:\d+$/, '');

      console.log('[funnel] host headers —', {
        'x-forwarded-host': req.headers['x-forwarded-host'] || null,
        'host':             req.headers.host || null,
        'resolved':         host,
      });

      if (!host) return res.status(400).send(notFoundPage('No domain detected.'));

      // LAYER 1 — domain-map doc (fast path)
      try {
        const snap = await db.collection('domain-map').doc(host).get();
        if (snap.exists) {
          const d = getData(snap);
          funnelId = d.funnelId;
          ownerUid = d.uid;
          console.log('[funnel] L1 hit — funnelId:', funnelId, '| ownerUid:', ownerUid || 'null');
          if (funnelId) {
            // Try user-scoped funnel first (most up-to-date)
            if (ownerUid) {
              try {
                const s = await db.collection('users').doc(ownerUid).collection('funnels').doc(funnelId).get();
                if (s.exists) funnel = getData(s);
              } catch(e) { console.warn('[funnel] L1 user-funnel error:', e.message); }
            }
            // FIX 2 — always fall back to published-funnels even when ownerUid is null
            if (!funnel) {
              try {
                const s = await db.collection('published-funnels').doc(funnelId).get();
                if (s.exists) {
                  const pf = getData(s);
                  // Only use published-funnels if it has real funnel content
                  if (pf && pf.status === 'live' && pf.pages && Object.keys(pf.pages).length > 0) {
                    funnel = pf;
                  } else if (pf && pf.status === 'live') {
                    // Has status but no pages — try to find full data via ownerUid in the doc
                    if (pf.ownerUid) {
                      try {
                        const s2 = await db.collection('users').doc(pf.ownerUid).collection('funnels').doc(funnelId).get();
                        if (s2.exists) funnel = getData(s2);
                      } catch(e) {}
                    }
                    if (!funnel) funnel = pf; // use what we have, page resolver will 404 gracefully
                  }
                }
              } catch(e) { console.warn('[funnel] L1 published-funnels error:', e.message); }
            }
          }
        }
      } catch(e) { console.error('[funnel] L1 error:', e.message); }

      // LAYER 2 — query published-funnels by domain field
      if (!funnel) {
        console.log('[funnel] L2 — querying published-funnels for domain:', host);
        try {
          const q = await db.collection('published-funnels')
            .where('domain', '==', host).limit(1).get();
          if (!q.empty) {
            const pf = getData(q.docs[0]);
            funnelId = pf.id || q.docs[0].id;
            ownerUid = pf.ownerUid || null;
            console.log('[funnel] L2 hit — funnelId:', funnelId);
            // If published-funnels has full data, use it
            if (pf.pages && Object.keys(pf.pages).length > 0) {
              funnel = pf;
            } else if (ownerUid) {
              // Fetch full data from user-scoped collection
              try {
                const s = await db.collection('users').doc(ownerUid).collection('funnels').doc(funnelId).get();
                if (s.exists) funnel = getData(s);
              } catch(e) {}
              if (!funnel) funnel = pf;
            } else {
              funnel = pf;
            }
            repairDomainMap(db, host, funnelId, ownerUid);
          }
        } catch(e) { console.error('[funnel] L2 error:', e.message); }
      }

      // LAYER 3 — try www variant
      if (!funnel) {
        console.log('[funnel] L3 — trying www variant');
        try {
          const q = await db.collection('published-funnels')
            .where('domain', '==', 'www.' + host).limit(1).get();
          if (!q.empty) {
            const pf = getData(q.docs[0]);
            funnelId = pf.id || q.docs[0].id;
            ownerUid = pf.ownerUid || null;
            console.log('[funnel] L3 hit — funnelId:', funnelId);
            if (pf.pages && Object.keys(pf.pages).length > 0) {
              funnel = pf;
            } else if (ownerUid) {
              try {
                const s = await db.collection('users').doc(ownerUid).collection('funnels').doc(funnelId).get();
                if (s.exists) funnel = getData(s);
              } catch(e) {}
              if (!funnel) funnel = pf;
            } else {
              funnel = pf;
            }
            repairDomainMap(db, host, funnelId, ownerUid);
          }
        } catch(e) { console.error('[funnel] L3 error:', e.message); }
      }

      // LAYER 4 — deep scan: check both published-funnels domain field AND
      // user-scoped funnels. FIX 3: direct domain match now handles ownerUid:null
      // funnels that the old loop skipped.
      if (!funnel) {
        console.log('[funnel] L4 — deep scan for domain:', host);
        try {
          const allPublished = await db.collection('published-funnels')
            .where('status', '==', 'live').get();

          for (const doc of allPublished.docs) {
            const d = getData(doc);

            // FIX 3 — direct domain match on published-funnels (catches ownerUid:null)
            const directDomain = (d.domain || '').replace(/^www\./, '').toLowerCase().trim();
            if (directDomain === host) {
              console.log('[funnel] L4 direct-domain hit — funnelId:', doc.id);
              funnelId = doc.id;
              ownerUid = d.ownerUid || null;
              // Try to get full data from user-scoped collection if ownerUid available
              if (ownerUid) {
                try {
                  const s = await db.collection('users').doc(ownerUid).collection('funnels').doc(funnelId).get();
                  if (s.exists) { funnel = getData(s); break; }
                } catch(e) {}
              }
              // Fall back to the published-funnels data we already have
              if (!funnel && d.pages && Object.keys(d.pages).length > 0) {
                funnel = d;
              }
              if (funnel) {
                repairDomainMap(db, host, funnelId, ownerUid);
                break;
              }
            }

            // Original uid-based deep scan (finds funnels where published-funnels
            // has domain:'' but users/{uid}/funnels has the correct domain)
            if (!d.ownerUid) continue;
            try {
              const userFunnelSnap = await db.collection('users').doc(d.ownerUid)
                .collection('funnels').doc(doc.id).get();
              if (userFunnelSnap.exists) {
                const uf = getData(userFunnelSnap);
                const ufDomain = (uf.domain || '').replace(/^www\./, '').toLowerCase().trim();
                if (ufDomain === host && uf.status === 'live') {
                  funnel   = uf;
                  funnelId = doc.id;
                  ownerUid = d.ownerUid;
                  console.log('[funnel] L4 user-scan hit — uid:', ownerUid, 'funnelId:', funnelId);
                  repairDomainMap(db, host, funnelId, ownerUid);
                  db.collection('published-funnels').doc(funnelId)
                    .set({ domain: host }, { merge: true }).catch(() => {});
                  break;
                }
              }
            } catch(e) {}
          }
        } catch(e) { console.error('[funnel] L4 error:', e.message); }
      }

      if (!funnel) console.log('[funnel] All layers failed for:', host);
    }

    if (!funnel) return res.status(404).send(notFoundPage('Funnel not found', fid));
    if (funnel.status !== 'live') return res.status(403).send(notFoundPage('This funnel is not published yet.', fid));

    // ── RESOLVE PAGE ──────────────────────────────────────────────────────────
    const pages     = funnel.pages     || {};
    const pageOrder = funnel.pageOrder || Object.keys(pages);
    const pagePaths = funnel.pagePaths || {};
    const homePage  = funnel.homePage  || pageOrder[0];

    const pathMap = {};
    pageOrder.forEach(pid => {
      const raw  = pagePaths[pid];
      if (raw != null) {
        const norm = raw === '' ? '/' : (raw.startsWith('/') ? raw : '/' + raw);
        pathMap[norm] = pid;
      }
    });
    pathMap['/'] = homePage;
    pathMap['']  = homePage;

    let resolvedPageId = null;
    if (pageParam && pages[pageParam]) {
      resolvedPageId = pageParam;
    } else if (pathParam) {
      const n = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
      resolvedPageId = pathMap[n] || pathMap[n.toLowerCase()] || null;
    } else {
      const urlPath  = (req.url || '/').split('?')[0] || '/';
      const normPath = urlPath || '/';
      if (normPath === '/' || normPath === '') {
        resolvedPageId = homePage;
      } else {
        resolvedPageId = pathMap[normPath] || pathMap[normPath.toLowerCase()]
          || pathMap[normPath.replace(/\/$/, '')] || null;
        if (!resolvedPageId) {
          const seg = normPath.replace(/^\//, '').split('/').pop();
          if (seg && pages[seg]) resolvedPageId = seg;
        }
      }
    }
    if (!resolvedPageId) resolvedPageId = homePage || pageOrder[0];

    const pageData = pages[resolvedPageId];
    if (!pageData || !pageData.html) {
      return res.status(404).send(notFoundPage('Page not found: ' + resolvedPageId, fid));
    }

    // ── SERVE ─────────────────────────────────────────────────────────────────
    const baseUrl   = fid ? '/api/funnel?fid=' + fid + (uid ? '&uid=' + uid : '') : '';
    const navScript = buildNavScript(baseUrl, resolvedPageId, pageOrder, pagePaths, funnel.domain);
    const html      = injectIntoHtml(pageData.html, navScript);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Funnel-Page', resolvedPageId);
    res.setHeader('X-Funnel-Id',   funnel.id || fid || '');
    return res.status(200).send(html);

  } catch(err) {
    console.error('[api/funnel] Fatal error:', err.message);
    return res.status(500).send(notFoundPage('Server error: ' + err.message));
  }
};

function buildNavScript(baseUrl, currentPageId, pageOrder, pagePaths, domain) {
  const pageUrls = {};
  pageOrder.forEach(pid => {
    const path = pagePaths[pid] || '/' + pid;
    pageUrls[pid] = domain ? 'https://' + domain + path : (baseUrl ? baseUrl + '&page=' + pid : '');
  });
  return `<script>
window.__eosFunnel = ${JSON.stringify({ currentPage: currentPageId, pageUrls })};
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('a[href], button[data-page]').forEach(function(el) {
    var t = el.getAttribute('href') || el.getAttribute('data-page') || '';
    if (t && window.__eosFunnel.pageUrls[t]) {
      if (el.tagName === 'A') el.href = window.__eosFunnel.pageUrls[t];
      else el.addEventListener('click', function() { window.location.href = window.__eosFunnel.pageUrls[t]; });
    }
  });
  var order = ${JSON.stringify(pageOrder)};
  var idx = order.indexOf('${currentPageId}');
  var next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  if (next && window.__eosFunnel.pageUrls[next]) {
    document.querySelectorAll('[data-next]').forEach(function(el) {
      el.addEventListener('click', function() { window.location.href = window.__eosFunnel.pageUrls[next]; });
    });
  }
});
</script>`;
}

function injectIntoHtml(html, script) {
  return html.includes('</body>') ? html.replace('</body>', script + '\n</body>') : html + script;
}

function notFoundPage(message, fid) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page Not Found</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0c0c20;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}.wrap{max-width:440px;text-align:center}.icon{font-size:48px;margin-bottom:16px}h1{font-size:22px;font-weight:800;margin-bottom:10px;font-family:Poppins,sans-serif}p{font-size:13px;color:rgba(255,255,255,.5);line-height:1.7}.code{background:rgba(255,255,255,.06);border-radius:6px;padding:4px 10px;font-family:monospace;font-size:12px;color:rgba(255,255,255,.4);margin-top:12px;display:inline-block}</style>
</head><body><div class="wrap"><div class="icon">🔗</div><h1>${message}</h1>
<p>This page could not be loaded. If you own this funnel, make sure it is published and the domain is correctly connected.</p>
${fid ? '<div class="code">Funnel ID: ' + fid + '</div>' : ''}</div></body></html>`;
}
