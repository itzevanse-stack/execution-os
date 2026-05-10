// api/verify-domain.js — checks DNS and registers domain→funnel mapping
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId, uid } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase();

  try {
    // Check DNS via Google DNS API
    const dnsResp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=CNAME`,
      { headers: { 'Accept': 'application/json' } }
    );
    const dnsData = await dnsResp.json();
    const answers = dnsData.Answer || [];

    // Also check A records as some providers use those
    const dnsAResp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=A`,
      { headers: { 'Accept': 'application/json' } }
    );
    const dnsAData = await dnsAResp.json();
    const aAnswers = dnsAData.Answer || [];

    const vercelTargets = [
      'cname.vercel-dns.com',
      'vercel-dns.com',
      'execution-os-xi.vercel.app',
      '76.76.21.21',    // Vercel IP
      '76.76.21.9',
    ];

    const pointsToVercel = answers.some(a =>
      a.data && vercelTargets.some(t => (a.data || '').toLowerCase().includes(t))
    ) || aAnswers.some(a =>
      a.data && vercelTargets.some(t => (a.data || '').includes(t))
    );

    if (pointsToVercel && funnelId && uid) {
      // Register domain→funnel mapping in Firestore
      // so the funnel serve endpoint knows which funnel to load for this domain
      try {
        const { initializeApp, getApps, cert } = require('firebase-admin/app');
        const { getFirestore } = require('firebase-admin/firestore');
        if (!getApps().length) {
          initializeApp({ credential: cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
          })});
        }
        const db = getFirestore();
        await db.collection('domain-map').doc(cleanDomain).set({
          domain: cleanDomain,
          funnelId,
          uid,
          verifiedAt: new Date().toISOString(),
        });
      } catch(e) { console.warn('Domain map save error:', e.message); }
    }

    return res.status(200).json({
      verified: pointsToVercel,
      domain:   cleanDomain,
      reason:   pointsToVercel
        ? 'DNS verified — domain is pointing to Execution OS'
        : 'DNS not yet propagated. Your CNAME must point to cname.vercel-dns.com. This can take up to 24 hours.',
      answers:  [...answers, ...aAnswers].map(a => a.data).filter(Boolean),
      funnelUrl: pointsToVercel ? `https://execution-os-xi.vercel.app/api/funnel?fid=${funnelId}&uid=${uid}` : null,
    });

  } catch(err) {
    console.error('Domain verify error:', err.message);
    return res.status(500).json({ verified: false, error: err.message });
  }
};
