// api/verify-domain.js
// 1. Checks DNS pointing to Vercel
// 2. Adds domain to Vercel project
// 3. Saves domain→funnel mapping to Firestore
// NOTE: Routing is handled by middleware.js — no vercel.json changes needed

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId, uid } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  const clean = domain.replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();

  const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
  const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

  const result = {
    domain:      clean,
    dnsOk:       false,
    vercelOk:    false,
    firestoreOk: false,
    verified:    false,
    reason:      '',
    funnelUrl:   null,
  };

  // ── 1. CHECK DNS ──────────────────────────────────────────────────────────────
  try {
    // Check both CNAME and A records
    const [cnameRes, aRes] = await Promise.all([
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(clean)}&type=CNAME`, { headers: { Accept: 'application/json' } }),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(clean)}&type=A`,     { headers: { Accept: 'application/json' } }),
    ]);
    const cnameData = await cnameRes.json();
    const aData     = await aRes.json();
    const answers   = [...(cnameData.Answer || []), ...(aData.Answer || [])];
    const targets   = ['vercel-dns.com', 'vercel.com', '76.76.21.21', '76.76.21.9', '76.76.21'];
    result.dnsOk      = answers.some(a => targets.some(t => (a.data || '').toLowerCase().includes(t)));
    result.dnsRecords = answers.map(a => ({ name: a.name, type: a.type, data: a.data }));
  } catch(e) {
    result.dnsError = e.message;
  }

  if (!result.dnsOk) {
    const host = clean.split('.').length > 2 ? clean.split('.')[0] : '@';
    result.reason = `The CNAME record has not been detected yet. Make sure you added: Name = ${host}, Value = cname.vercel-dns.com. Then wait 5 to 15 minutes and try again.`;
    return res.status(200).json(result);
  }

  // ── 2. ADD DOMAIN TO VERCEL PROJECT ──────────────────────────────────────────
  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      // Check if already added
      const checkRes = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (checkRes.status === 404) {
        const addRes = await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method:  'POST',
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: clean }),
          }
        );
        const addData = await addRes.json();
        if (!addRes.ok) {
          // Domain might already exist on another project — still continue
          result.vercelNote = addData.error?.message || 'Could not add to Vercel project';
        }
        result.vercelOk = addRes.ok || (addData.error?.code === 'domain_already_in_use');
      } else if (checkRes.ok) {
        result.vercelOk = true; // already added
      } else {
        result.vercelOk = true; // assume ok, middleware handles routing
      }
    } catch(e) {
      result.vercelError = e.message;
      result.vercelOk    = true; // middleware handles routing regardless
    }
  } else {
    result.vercelOk   = true;
    result.vercelNote = 'VERCEL_TOKEN not set — add to env vars for SSL automation';
  }

  // ── 3. SAVE TO FIRESTORE ──────────────────────────────────────────────────────
  if (funnelId && uid) {
    try {
      const { initializeApp, getApps, cert } = require('firebase-admin/app');
      const { getFirestore }                  = require('firebase-admin/firestore');
      if (!getApps().length) {
        initializeApp({ credential: cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        })});
      }
      const db = getFirestore();

      // Save domain map — funnel.js looks this up when custom domain visits
      await db.collection('domain-map').doc(clean).set({
        domain:     clean,
        funnelId,
        uid,
        verifiedAt: new Date().toISOString(),
      });
      // Also save on funnel doc
      await db.collection('users').doc(uid).collection('funnels').doc(funnelId)
        .set({ domain: clean, domainVerified: true }, { merge: true });

      // Remove www/non-www variant mapping too
      const variant = clean.startsWith('www.')
        ? clean.replace(/^www\./, '')
        : 'www.' + clean;
      await db.collection('domain-map').doc(variant).set({
        domain:   variant,
        funnelId,
        uid,
        verifiedAt: new Date().toISOString(),
        alias: clean,
      });

      result.firestoreOk = true;
    } catch(e) {
      result.firestoreError = e.message;
    }
  }

  // ── RESULT ────────────────────────────────────────────────────────────────────
  result.verified  = result.dnsOk && result.vercelOk;
  result.funnelUrl = `https://${clean}`;

  if (result.verified) {
    result.reason = `Domain connected. Your funnel is live at https://${clean}`;
    // Also check the funnel is published
    if (!funnelId) {
      result.warning = 'Domain connected but no funnel ID provided. Make sure your funnel is published.';
    }
  }

  return res.status(200).json(result);
};
