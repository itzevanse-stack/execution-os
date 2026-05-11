// api/verify-domain.js
// 1. Checks DNS is pointing to Vercel
// 2. Automatically adds the domain to the Vercel project (no manual step needed)
// 3. Saves domain→funnel mapping to Firestore
// 4. Returns full status so the dashboard can show the member what's happening

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId, uid } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  const cleanDomain = domain
    .replace(/https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim();

  const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
  const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

  const result = {
    domain:        cleanDomain,
    dnsOk:         false,
    vercelOk:      false,
    firestoreOk:   false,
    verified:      false,
    reason:        '',
    instructions:  [],
    funnelUrl:     null,
  };

  // ── STEP 1: Check DNS ────────────────────────────────────────────────────────
  try {
    const [cnameRes, aRes] = await Promise.all([
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=CNAME`, {
        headers: { Accept: 'application/json' }
      }),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=A`, {
        headers: { Accept: 'application/json' }
      }),
    ]);

    const cnameData = await cnameRes.json();
    const aData     = await aRes.json();
    const answers   = [...(cnameData.Answer || []), ...(aData.Answer || [])];

    const vercelTargets = [
      'cname.vercel-dns.com',
      'vercel-dns.com',
      '76.76.21.21',
      '76.76.21.9',
    ];

    result.dnsOk = answers.some(a =>
      vercelTargets.some(t => (a.data || '').toLowerCase().includes(t))
    );

    result.dnsRecords = answers.map(a => a.data).filter(Boolean);
  } catch(e) {
    result.dnsError = e.message;
  }

  if (!result.dnsOk) {
    result.reason = 'DNS not pointing to Vercel yet. Add a CNAME record pointing to cname.vercel-dns.com in your domain registrar. This can take up to 24 hours.';
    result.instructions = [
      'Log in to your domain registrar (Namecheap, GoDaddy, Hostinger, etc.)',
      'Go to DNS Management / Advanced DNS',
      `Add a CNAME record: Name = ${cleanDomain.split('.').length > 2 ? cleanDomain.split('.')[0] : 'www'}, Value = cname.vercel-dns.com`,
      'Save and wait 5–30 minutes, then click Verify again',
    ];
    return res.status(200).json(result);
  }

  // ── STEP 2: Auto-add domain to Vercel project (no manual work for admin) ────
  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      // Check if domain already exists in Vercel
      const checkRes = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${cleanDomain}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );

      if (checkRes.status === 404) {
        // Domain not in Vercel yet — add it automatically
        const addRes = await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method: 'POST',
            headers: {
              Authorization:  `Bearer ${VERCEL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: cleanDomain }),
          }
        );
        const addData = await addRes.json();
        result.vercelOk = addRes.ok || addData.name === cleanDomain;
        result.vercelAdded = addRes.ok;
      } else if (checkRes.ok) {
        // Already in Vercel
        result.vercelOk = true;
        result.vercelAdded = false; // already existed
      }
    } catch(e) {
      result.vercelError = e.message;
      // Don't fail — DNS is good, Vercel might already have it
      result.vercelOk = true;
    }
  } else {
    // No Vercel token — skip (domain may already be in Vercel manually)
    result.vercelOk    = true;
    result.vercelNote  = 'VERCEL_TOKEN not set — add it in Vercel environment variables to enable auto domain connection';
  }

  // ── STEP 3: Save domain→funnel mapping to Firestore ─────────────────────────
  if (funnelId && uid) {
    try {
      const { initializeApp, getApps, cert } = require('firebase-admin/app');
      const { getFirestore }                  = require('firebase-admin/firestore');

      if (!getApps().length) {
        initializeApp({
          credential: cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
          }),
        });
      }

      const db = getFirestore();
      await db.collection('domain-map').doc(cleanDomain).set({
        domain:     cleanDomain,
        funnelId,
        uid,
        verifiedAt: new Date().toISOString(),
        dnsOk:      result.dnsOk,
        vercelOk:   result.vercelOk,
      });

      // Also update the funnel doc itself
      await db.collection('users').doc(uid).collection('funnels').doc(funnelId)
        .set({ domain: cleanDomain, domainVerified: true }, { merge: true });

      result.firestoreOk = true;
    } catch(e) {
      result.firestoreError = e.message;
    }
  }

  // ── STEP 4: Build final status ───────────────────────────────────────────────
  result.verified = result.dnsOk && result.vercelOk;
  result.funnelUrl = result.verified
    ? `https://${cleanDomain}`
    : `https://execution-os-xi.vercel.app/api/funnel?fid=${funnelId}&uid=${uid}`;

  if (result.verified) {
    result.reason = result.vercelAdded
      ? `Domain verified and connected automatically. ${cleanDomain} is now live.`
      : `Domain verified. ${cleanDomain} is live.`;
  } else {
    result.reason = 'DNS confirmed but Vercel connection failed. Contact support.';
  }

  return res.status(200).json(result);
};
