// api/verify-domain.js — robust multi-resolver DNS check

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

  const VERCEL_TARGETS = [
    'cname.vercel-dns.com',
    'vercel-dns.com',
    'vercel.com',
    '76.76.21.',
    '76.76.19.',
  ];

  // ── helper: single DNS resolver query ──────────────────────────────────────
  async function dnsQuery(baseUrl, name, type) {
    try {
      const url = `${baseUrl}?name=${encodeURIComponent(name)}&type=${type}`;
      const r   = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { answers: [], raw: `HTTP ${r.status}` };
      const j   = await r.json();
      const ans = (j.Answer || j.authority || []).map(a =>
        ((a.data || a.rdata || '') + '').toLowerCase().replace(/\.$/, '').trim()
      );
      return { answers: ans, raw: JSON.stringify(j).slice(0, 300) };
    } catch(e) {
      return { answers: [], raw: e.message };
    }
  }

  // ── 1. CHECK DNS — 3 resolvers, CNAME + A each ────────────────────────────
  const checks = await Promise.allSettled([
    dnsQuery('https://dns.google/resolve',            clean, 'CNAME'),
    dnsQuery('https://dns.google/resolve',            clean, 'A'),
    dnsQuery('https://cloudflare-dns.com/dns-query',  clean, 'CNAME'),
    dnsQuery('https://cloudflare-dns.com/dns-query',  clean, 'A'),
    dnsQuery('https://8.8.8.8/resolve',               clean, 'CNAME'),
    dnsQuery('https://8.8.8.8/resolve',               clean, 'A'),
  ]);

  const allAnswers = checks
    .filter(c => c.status === 'fulfilled')
    .flatMap(c => c.value.answers);

  const rawDebug = checks
    .filter(c => c.status === 'fulfilled')
    .map((c, i) => ({ i, raw: c.value.raw, answers: c.value.answers }));

  const uniqueAnswers = [...new Set(allAnswers)].filter(Boolean);

  const dnsOk = uniqueAnswers.some(a =>
    VERCEL_TARGETS.some(t => a.includes(t))
  );

  // ── 2. VERCEL API CHECK — if DNS check fails, try Vercel directly ─────────
  let vercelConfirmed = false;
  if (!dnsOk && VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const vr   = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      const vd   = await vr.json();
      // Vercel returns verified:true or a verification array all satisfied
      vercelConfirmed =
        vd.verified === true ||
        (Array.isArray(vd.verification) && vd.verification.every(v => v.verified)) ||
        vd.gitBranch !== undefined; // domain already fully configured
    } catch(e) { /* ignore */ }
  }

  const domainVerified = dnsOk || vercelConfirmed;

  // Return early if not verified — include debug info so we can diagnose
  if (!domainVerified) {
    const host   = clean.split('.').length > 2 ? clean.split('.')[0] : '@';
    const found  = uniqueAnswers.length
      ? `Your domain currently resolves to: ${uniqueAnswers.join(', ')}`
      : 'No DNS records found yet.';
    return res.status(200).json({
      verified:    false,
      domain:      clean,
      dnsOk:       false,
      reason:      `CNAME not pointing to Vercel. Name = ${host}, Value = cname.vercel-dns.com. ${found}`,
      dnsRecords:  uniqueAnswers,
      debug:       rawDebug,   // ← we can read this in the browser console
    });
  }

  // ── 3. ADD DOMAIN TO VERCEL PROJECT ────────────────────────────────────────
  let vercelOk = false;
  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const chk = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (chk.status === 404) {
        const add = await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method:  'POST',
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: clean }),
          }
        );
        vercelOk = add.ok;
      } else {
        vercelOk = true;
      }
    } catch(e) {
      vercelOk = true; // middleware handles routing regardless
    }
  } else {
    vercelOk = true;
  }

  // ── 4. SAVE TO FIRESTORE — www + non-www + funnel doc ─────────────────────
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
      const db     = getFirestore();
      const record = { domain: clean, funnelId, uid, verifiedAt: new Date().toISOString() };
      const noWww  = clean.replace(/^www\./, '');
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
      console.error('Firestore error:', e.message);
    }
  }

  return res.status(200).json({
    verified:    true,
    domain:      clean,
    dnsOk:       true,
    vercelOk,
    firestoreOk,
    funnelUrl:   `https://${clean}`,
    reason:      `Domain connected. Your funnel is live at https://${clean}`,
    dnsRecords:  uniqueAnswers,
  });
};
