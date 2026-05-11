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
    let pageId   = req.query.page || 'landing';

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

    const pages  = funnelData.pages || {};
    const pageKeys = Object.keys(pages);
    const page   = pages[pageId] || pages[pageKeys[0]];

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
    const tracking = `<script>(function(){document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(){var d={funnelId:'${funnelId}',uid:'${uid||''}',pageId:'${pageId}',ts:Date.now()};var e=f.querySelector('[type=email]');var n=f.querySelector('[type=text],[name=name]');if(e)d.email=e.value;if(n)d.name=n.value;fetch('https://execution-os-xi.vercel.app/api/funnel-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).catch(function(){});});});})();</script>`;

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
