const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getDb();

    let funnelId = req.query.fid || req.query.funnel_id;
    let uid      = req.query.uid;
    let pageId   = req.query.page || null; // null = use first page in funnel

    // Look up by domain — try both with and without www
    if (!funnelId) {
      const rawHost = (req.query.host || req.headers.host || '').toLowerCase().trim();
      const hostNaked = rawHost.replace(/^www\./, '');
      const hostsToTry = [rawHost, hostNaked, 'www.' + hostNaked].filter(Boolean);

      for (const h of hostsToTry) {
        try {
          const snap = await db.collection('domain-map').doc(h).get();
          if (snap.exists) {
            const data = snap.data();
            funnelId = data.funnelId;
            uid      = data.uid;
            pageId   = req.query.page || data.defaultPage || 'landing';
            break;
          }
        } catch(e) { /* try next */ }
      }
    }

    if (!funnelId) {
      return res.status(200).send(setupPage());
    }

    // Load funnel data
    let funnelData = null;
    if (uid) {
      try {
        const snap = await db.collection('users').doc(uid).collection('funnels').doc(funnelId).get();
        if (snap.exists) funnelData = snap.data();
      } catch(e) {}
    }
    if (!funnelData) {
      try {
        const snap = await db.collection('published-funnels').doc(funnelId).get();
        if (snap.exists) funnelData = snap.data();
      } catch(e) {}
    }

    if (!funnelData) {
      return res.status(404).send(errorPage('Funnel not found. Make sure it has been published from your Execution OS dashboard.'));
    }

    if (funnelData.status !== 'live') {
      return res.status(200).send(errorPage('This funnel is not live yet. Publish it from your Execution OS dashboard first.'));
    }

    const pages     = funnelData.pages || {};
    const pageOrder = funnelData.pageOrder || Object.keys(pages);
    const pagePaths = funnelData.pagePaths || {};

    // Resolve page by URL path first (e.g. /thank-you → thank-you page)
    if (!pageId || !pages[pageId]) {
      const reqPath = ('/' + (req.url || '').split('?')[0].replace(/^\//, '')).toLowerCase().replace(/\/+$/, '') || '/';

      // Check if URL path matches any saved page path
      const matchedId = Object.keys(pagePaths).find(function(id) {
        const p = (pagePaths[id] || '').toLowerCase().replace(/\/+$/, '') || '/';
        return p === reqPath;
      });

      if (matchedId && pages[matchedId]) {
        pageId = matchedId;
      } else {
        // Default to first page
        pageId = pageOrder[0] || Object.keys(pages)[0];
      }
    }
    const page = pages[pageId];

    if (!page || !page.html) {
      return res.status(404).send(errorPage('Page not found in this funnel.'));
    }

    // Track visit
    try {
      if (uid) {
        await db.collection('users').doc(uid).collection('funnels').doc(funnelId).update({
          views: (funnelData.views || 0) + 1,
          lastView: Date.now(),
        });
      }
    } catch(e) { /* non-critical */ }

    // Inject lead tracking
    const tracking = `<script>
(function(){
  var _fid='${funnelId}';
  var _uid='${uid||''}';
  var _pid='${pageId}';
  var _api='https://execution-os-xi.vercel.app/api/funnel-lead';

  // Global function so popup onclick can call it directly
  window.captureEOSLead = function(email, name) {
    if (!email || !email.includes('@')) return false;
    fetch(_api, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({funnelId:_fid, uid:_uid, pageId:_pid, email:email, name:name||'', source:'funnel', ts:Date.now()})
    }).catch(function(){});
    return true;
  };

  // Listen to any real form submits
  document.addEventListener('submit', function(e) {
    var form = e.target;
    var emailEl = form.querySelector('[type=email],[name=email],[id=le],[id=lead-email],[placeholder*=email i]');
    var nameEl  = form.querySelector('[type=text],[name=name],[id=ln],[id=lead-name],[placeholder*=name i]');
    if (emailEl && emailEl.value) {
      window.captureEOSLead(emailEl.value.trim(), nameEl ? nameEl.value.trim() : '');
    }
  });

  // Also watch for clicks on submit/CTA buttons inside modal
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn || !btn.tagName) return;
    var tag = btn.tagName.toLowerCase();
    if (tag !== 'button' && tag !== 'input' && tag !== 'a') return;
    var txt = (btn.textContent || btn.value || '').toLowerCase();
    var isSubmit = btn.type === 'submit' || /get.*(access|started|free)|submit|join|sign.?up|subscribe/i.test(txt);
    if (!isSubmit) return;
    // Find closest email input in the same container
    var container = btn.closest('form') || btn.closest('[id*=modal]') || btn.closest('[id*=popup]') || btn.parentElement;
    if (!container) return;
    var emailEl = container.querySelector('[type=email],[name=email],[id=le],[id=lead-email]');
    var nameEl  = container.querySelector('[type=text],[name=name],[id=ln],[id=lead-name]');
    if (emailEl && emailEl.value && emailEl.value.includes('@')) {
      window.captureEOSLead(emailEl.value.trim(), nameEl ? nameEl.value.trim() : '');
    }
  });

  // Track page view
  fetch(_api.replace('funnel-lead','funnel-view'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({funnelId:_fid, uid:_uid, pageId:_pid})
  }).catch(function(){});
})();
</script>`;

    let html = page.html;
    html = html.includes('</body>') ? html.replace('</body>', tracking + '</body>') : html + tracking;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Powered-By', 'Execution OS');
    return res.status(200).send(html);

  } catch(err) {
    console.error('Funnel error:', err.message);
    return res.status(500).send(errorPage('Something went wrong. Please try again in a moment.'));
  }
};

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coming Soon</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#06060f;color:#c8cde8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}h1{font-size:1.5rem;color:#fff;margin-bottom:.75rem}p{color:#7a7a9d;font-size:.9rem;line-height:1.7;max-width:380px}</style></head><body><div><h1>Coming Soon</h1><p>${msg}</p></div></body></html>`;
}

function setupPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Domain Setup Pending</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#06060f;color:#c8cde8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem}h1{font-size:1.5rem;color:#fff;margin-bottom:.75rem}p{color:#7a7a9d;font-size:.9rem;line-height:1.7;max-width:380px}</style></head><body><div><h1>Domain connected</h1><p>Your domain is connected to Execution OS. Publish your funnel and link this domain from the Funnel Builder to make it live.</p></div></body></html>`;
}
