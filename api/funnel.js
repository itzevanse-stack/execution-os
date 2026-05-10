// api/funnel.js — serves published funnel pages
// When a member connects their custom domain, their CNAME points to Vercel.
// Vercel routes all traffic to this function which reads the funnel from Firestore
// and serves it as a full HTML page.
// Usage: https://theirdomain.com/?fid=funnel_1234  OR  https://theirdomain.com/ (if domain is mapped)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                 = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

module.exports = async function handler(req, res) {
  // CORS for preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getDb();

    // Determine which funnel to serve
    // Priority: ?fid=funnel_id > ?uid=uid&fid=fid > domain lookup
    let funnelId = req.query.fid || req.query.funnel_id;
    let uid      = req.query.uid;
    let pageId   = req.query.page || 'landing';

    // If no fid in query, try to look up by domain
    if (!funnelId) {
      const host = (req.headers.host || '').replace('www.', '').toLowerCase();

      // Search all users' funnels for one matching this domain
      // (We store domainMap: { "domain.com": { uid, funnelId } } in a top-level collection)
      try {
        const domainSnap = await db.collection('domain-map').doc(host).get();
        if (domainSnap.exists) {
          const data = domainSnap.data();
          funnelId = data.funnelId;
          uid      = data.uid;
          pageId   = req.query.page || data.defaultPage || 'landing';
        }
      } catch(e) { console.warn('Domain lookup error:', e.message); }
    }

    if (!funnelId) {
      return res.status(400).send(notFoundPage('No funnel ID specified. Add ?fid=your_funnel_id to the URL, or connect your domain through the Execution OS Funnel Builder.'));
    }

    // Fetch funnel from Firestore
    // Try domain-map first to get uid, otherwise scan (expensive)
    let funnelData = null;

    if (uid) {
      const fSnap = await db.collection('users').doc(uid).collection('funnels').doc(funnelId).get();
      if (fSnap.exists) funnelData = fSnap.data();
    } else {
      // Scan approach — only if no uid (less efficient, use sparingly)
      const publicSnap = await db.collection('published-funnels').doc(funnelId).get();
      if (publicSnap.exists) funnelData = publicSnap.data();
    }

    if (!funnelData) {
      return res.status(404).send(notFoundPage('Funnel not found. It may have been deleted or the URL is incorrect.'));
    }

    if (funnelData.status !== 'live') {
      return res.status(404).send(notFoundPage('This funnel is not live yet. The owner needs to publish it from the Execution OS dashboard.'));
    }

    // Get the specific page
    const pages = funnelData.pages || {};
    const page  = pages[pageId] || pages[Object.keys(pages)[0]];

    if (!page || !page.html) {
      return res.status(404).send(notFoundPage('Page not found in this funnel.'));
    }

    // Track the visit (fire and forget)
    try {
      if (uid) {
        const ref = db.collection('users').doc(uid).collection('funnels').doc(funnelId);
        const now = Date.now();
        await ref.update({
          views: (funnelData.views || 0) + 1,
          lastView: now,
          [`viewLog.${now}`]: { pageId, host: req.headers.host || '', ref: req.headers.referer || '' }
        });
      }
    } catch(e) { /* non-critical */ }

    // Inject tracking script into the page HTML
    const trackingScript = `
<script>
(function() {
  // Track opt-in form submissions back to Execution OS
  document.querySelectorAll('form').forEach(function(form) {
    form.addEventListener('submit', function() {
      var data = { funnelId: '${funnelId}', uid: '${uid || ''}', pageId: '${pageId}', ts: Date.now() };
      var emailEl = form.querySelector('[type=email]');
      var nameEl  = form.querySelector('[type=text],[name=name],[name=Name]');
      if (emailEl) data.email = emailEl.value;
      if (nameEl)  data.name  = nameEl.value;
      fetch('https://execution-os-xi.vercel.app/api/funnel-lead', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
      }).catch(function(){});
    });
  });
})();
</script>`;

    // Inject before </body>
    let html = page.html;
    if (html.includes('</body>')) {
      html = html.replace('</body>', trackingScript + '\n</body>');
    } else {
      html = html + trackingScript;
    }

    // Serve with appropriate headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('X-Powered-By', 'Execution OS');
    return res.status(200).send(html);

  } catch(err) {
    console.error('Funnel serve error:', err);
    return res.status(500).send(notFoundPage('Server error. Please try again shortly.'));
  }
};

function notFoundPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page Not Found</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Poppins',sans-serif,system-ui;background:#06060f;color:#c8cde8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}.wrap{max-width:420px}.ico{font-size:48px;margin-bottom:1rem}.h1{font-size:24px;font-weight:900;color:#fff;margin-bottom:.75rem}.p{font-size:14px;line-height:1.7;color:#7a7a9d}.badge{margin-top:2rem;font-size:11px;color:#4a4a70;padding:8px 16px;border:1px solid rgba(255,255,255,.06);border-radius:50px;display:inline-block}</style></head><body><div class="wrap"><div class="ico">🔒</div><h1 class="h1">Page unavailable</h1><p class="p">${msg}</p><div class="badge">Powered by Execution OS</div></div></body></html>`;
}
