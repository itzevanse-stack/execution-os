/**
 * api/funnel.js
 *
 * Serves published funnel pages.
 * Domain resolution — 4 layers, each a fallback for the previous:
 *
 *   Layer 1 — domain-map doc lookup (fastest)
 *   Layer 2 — published-funnels query where domain == host
 *   Layer 3 — published-funnels query where domain == www.host
 *   Layer 4 — scan domain-map for any record matching host, repair and serve
 *
 * When a funnel is found via Layer 2-4, domain-map is auto-repaired so
 * subsequent requests hit Layer 1 instantly.
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
      const host = (req.headers.host || '').toLowerCase()
        .replace(/^www\./, '')
        .replace(/:\d+$/, '');

      if (!host) return res.status(400).send(notFoundPage('No domain detected.'));
      console.log('[funnel] Domain request:', host);

      // LAYER 1 — domain-map doc (fast path)
      try {
        const snap = await db.collection('domain-map').doc(host).get();
        if (snap.exists) {
          const d = getData(snap);
          funnelId = d.funnelId;
          ownerUid = d.uid;
          console.log('[funnel] L1 hit — funnelId:', funnelId);
          if (funnelId) {
            if (ownerUid) {
              try {
                const s = await db.collection('users').doc(ownerUid).collection('funnels').doc(funnelId).get();
                if (s.exists) funnel = getData(s);
              } catch(e) {}
            }
            if (!funnel) {
              try {
                const s = await db.collection('published-funnels').doc(funnelId).get();
                if (s.exists) funnel = getData(s);
              } catch(e) {}
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
            funnel   = getData(q.docs[0]);
            funnelId = funnel.id || q.docs[0].id;
            ownerUid = funnel.ownerUid || null;
            console.log('[funnel] L2 hit — repairing domain-map');
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
            funnel   = getData(q.docs[0]);
            funnelId = funnel.id || q.docs[0].id;
            ownerUid = funnel.ownerUid || null;
            repairDomainMap(db, host, funnelId, ownerUid);
          }
        } catch(e) {}
      }

      // LAYER 4 — read from users/{uid}/funnels via ownerUid in published-funnels
      // This catches the case where published-funnels has domain:'' but
      // users/{uid}/funnels/{funnelId} has the correct domain
      // We do this by scanning published-funnels for funnels owned by anyone
      // whose user-scoped funnel matches the domain
      if (!funnel) {
        console.log('[funnel] L4 — scanning user funnels for domain:', host);
        try {
          // Get all live published funnels and check their authoritative user record
          const allPublished = await db.collection('published-funnels')
            .where('status', '==', 'live').get();

          for (const doc of allPublished.docs) {
            const d = getData(doc);
            if (!d.ownerUid) continue;
            try {
              const userFunnels = await db.collection('users').doc(d.ownerUid)
                .collection('funnels').doc(doc.id).get();
              if (userFunnels.exists) {
                const uf = getData(userFunnels);
                const ufDomain = (uf.domain || '').replace(/^www\./, '').toLowerCase();
                if (ufDomain === host && uf.status === 'live') {
                  funnel   = uf;
                  funnelId = doc.id;
                  ownerUid = d.ownerUid;
                  console.log('[funnel] L4 hit — uid:', ownerUid, 'funnelId:', funnelId);
                  // Repair everything so this never falls to L4 again
                  repairDomainMap(db, host, funnelId, ownerUid);
                  // Also repair published-funnels domain field
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
