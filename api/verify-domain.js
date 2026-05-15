// api/verify-domain.js
// Robust DNS check that works for ALL TLDs including .site .org .io .co etc

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId, uid } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  const clean = domain
    .replace(/https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim();

  const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
  const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

  // All known Vercel CNAME targets and IP ranges
  const VERCEL_TARGETS = [
    'cname.vercel-dns.com',
    'vercel-dns.com',
    '76.76.21.',
    '76.76.19.',
    '76.223.',
  ];

  // ── DNS query helper ────────────────────────────────────────────────────────
  // Works correctly for ALL TLDs by using proper DoH (DNS over HTTPS) format
  async function dnsQuery(resolver, name, type) {
    try {
      let url, headers;
      if (resolver === 'google') {
        url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/json' };
      } else if (resolver === 'cloudflare') {
        // Cloudflare requires application/dns-json content type
        url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/dns-json' };
      } else if (resolver === 'quad9') {
        url = `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/dns-json' };
      } else if (resolver === 'opendns') {
        url = `https://doh.opendns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/dns-json' };
      }

      const r = await fetch(url, { headers });
      if (!r.ok) return [];

      const j   = await r.json();
      const ans = (j.Answer || []).map(a =>
        ((a.data || '') + '').toLowerCase().replace(/\.$/, '').trim()
      );
      return ans;
    } catch(e) {
      return [];
    }
  }

  // ── 1. PARALLEL DNS CHECK — 4 resolvers × 2 record types ──────────────────
  const resolverNames = ['google', 'cloudflare', 'quad9', 'opendns'];
  const recordTypes   = ['CNAME', 'A'];

  const allQueries = [];
  for (const r of resolverNames) {
    for (const t of recordTypes) {
      allQueries.push(dnsQuery(r, clean, t));
    }
  }

  const results     = await Promise.allSettled(allQueries);
  const allAnswers  = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
  const uniqueAnswers = [...new Set(allAnswers)].filter(Boolean);

  const dnsOk = uniqueAnswers.some(a =>
    VERCEL_TARGETS.some(t => a.includes(t))
  );

  // ── 2. VERCEL API CHECK — always run this as backup ─────────────────────────
  // Especially important for .site / .org / .io where DNS resolvers are slower
  let vercelDomainData = null;
  let vercelConfirmed  = false;

  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      // First add the domain to the project if not already there
      const checkRes  = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );

      if (checkRes.status === 404) {
        // Domain not in project yet — add it
        await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method:  'POST',
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: clean }),
          }
        );
        // Re-fetch after adding
        const recheck = await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
          { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
        );
        if (recheck.ok) vercelDomainData = await recheck.json();
      } else if (checkRes.ok) {
        vercelDomainData = await checkRes.json();
      }

      // Check Vercel's own verification result
      if (vercelDomainData) {
        // Vercel confirmed it's correctly pointed
        vercelConfirmed = vercelDomainData.verified === true;

        // Also check if verification array shows CNAME is satisfied
        if (!vercelConfirmed && Array.isArray(vercelDomainData.verification)) {
          vercelConfirmed = vercelDomainData.verification.every(v => v.verified === true);
        }
      }
    } catch(e) {
      console.error('Vercel API error:', e.message);
    }
  }

  const domainVerified = dnsOk || vercelConfirmed;

  // ── NOT VERIFIED — return helpful error with what we actually found ─────────
  if (!domainVerified) {
    const isSubdomain = clean.split('.').length > 2;
    const host        = isSubdomain ? clean.split('.')[0] : '@';
    const tld         = clean.split('.').slice(-1)[0];

    let hint = '';
    if (uniqueAnswers.length && !uniqueAnswers.some(a => a.includes('vercel'))) {
      hint = `Your domain currently points to: ${uniqueAnswers.slice(0, 2).join(', ')}. This needs to point to cname.vercel-dns.com instead.`;
    } else if (uniqueAnswers.length === 0) {
      hint = `.${tld} domains can take longer to propagate. Wait 10 to 30 minutes and try again.`;
    }

    return res.status(200).json({
      verified:   false,
      domain:     clean,
      dnsOk:      false,
      reason:     `CNAME record not verified yet. Name = ${host}, Value = cname.vercel-dns.com. ${hint}`.trim(),
      dnsRecords: uniqueAnswers,
      vercelData: vercelDomainData,
    });
  }

  // ── VERIFIED — save to Firestore ─────────────────────────────────────────────
  let firestoreOk = false;
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
      const db      = getFirestore();
      const record  = { domain: clean, funnelId, uid, verifiedAt: new Date().toISOString() };
      const noWww   = clean.replace(/^www\./, '');
      const withWww = 'www.' + noWww;

      await Promise.all([
        db.collection('domain-map').doc(clean).set(record),
        db.collection('domain-map').doc(noWww).set({ ...record, domain: noWww }),
        db.collection('domain-map').doc(withWww).set({ ...record, domain: withWww }),
        db.collection('users').doc(uid).collection('funnels').doc(funnelId)
          .set({ domain: clean, domainVerified: true }, { merge: true }),
      ]);
      firestoreOk = true;
    } catch(e) {
      console.error('Firestore save error:', e.message);
    }
  }

  return res.status(200).json({
    verified:   true,
    domain:     clean,
    dnsOk:      true,
    firestoreOk,
    funnelUrl:  `https://${clean}`,
    reason:     `Domain connected. Your funnel is live at https://${clean}`,
    dnsRecords: uniqueAnswers,
  });
};
