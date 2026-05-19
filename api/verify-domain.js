// api/verify-domain.js
// Robust DNS check that works for ALL TLDs including .site .org .io .co etc
// Added: root domain A-record detection, Cloudflare orange-cloud detection,
//        structured guidance/action fields for the UI to display specific fixes.

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

  // Cloudflare proxy IP prefixes — if DNS resolves to these, orange cloud is ON
  // and the user needs to switch to DNS Only (grey cloud)
  const CLOUDFLARE_PROXY_PREFIXES = [
    '104.16.', '104.17.', '104.18.', '104.19.', '104.20.', '104.21.',
    '172.64.',  '172.65.',  '172.66.',  '172.67.',  '172.68.',  '172.69.',
    '172.70.',  '172.71.',
  ];

  // Root domain = exactly two parts: yourdomain.com / yourdomain.site / yourdomain.io
  // Subdomain   = three or more:     www.yourdomain.com / go.yourdomain.com
  const parts       = clean.split('.');
  const isRoot      = parts.length === 2;
  const isSubdomain = parts.length > 2;
  const host        = isSubdomain ? parts[0] : '@';
  const tld         = parts[parts.length - 1];

  // ── DNS query helper ────────────────────────────────────────────────────────
  // Works correctly for ALL TLDs by using proper DoH (DNS over HTTPS) format
  async function dnsQuery(resolver, name, type) {
    try {
      let url, headers;
      if (resolver === 'google') {
        url     = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/json' };
      } else if (resolver === 'cloudflare') {
        url     = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/dns-json' };
      } else if (resolver === 'quad9') {
        url     = `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
        headers = { Accept: 'application/dns-json' };
      } else if (resolver === 'opendns') {
        url     = `https://doh.opendns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
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

  const results       = await Promise.allSettled(allQueries);
  const allAnswers    = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
  const uniqueAnswers = [...new Set(allAnswers)].filter(Boolean);

  const dnsOk = uniqueAnswers.some(a =>
    VERCEL_TARGETS.some(t => a.includes(t))
  );

  // ── 1b. CLOUDFLARE ORANGE CLOUD DETECTION ──────────────────────────────────
  // If any resolved IP starts with a Cloudflare proxy prefix, the user has
  // orange cloud enabled — this proxies traffic through Cloudflare and breaks
  // Vercel's SSL certificate provisioning.
  const isCloudflareProxy = uniqueAnswers.some(a =>
    CLOUDFLARE_PROXY_PREFIXES.some(prefix => a.startsWith(prefix))
  );

  // ── 1c. ROOT DOMAIN A-RECORD CHECK ─────────────────────────────────────────
  // Root domains (yourdomain.com) cannot use CNAME at most registrars.
  // They need an A record pointing to 76.76.21.21.
  // If it is a root domain, check whether a valid Vercel A record exists.
  const VERCEL_A_IPS = ['76.76.21.21', '76.76.19.61'];
  const hasVercelA   = uniqueAnswers.some(a => VERCEL_A_IPS.includes(a));
  const hasCname     = uniqueAnswers.some(a => a.includes('vercel-dns.com'));

  // For root domains, A record OR CNAME (some providers allow flat CNAME) both work
  const rootDomainOk = isRoot && (hasVercelA || hasCname);

  // ── 2. VERCEL API CHECK — always run as backup ─────────────────────────────
  // Especially important for .site / .org / .io where DNS resolvers are slower
  let vercelDomainData = null;
  let vercelConfirmed  = false;

  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const checkRes = await fetch(
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

      if (vercelDomainData) {
        vercelConfirmed = vercelDomainData.verified === true;
        if (!vercelConfirmed && Array.isArray(vercelDomainData.verification)) {
          vercelConfirmed = vercelDomainData.verification.every(v => v.verified === true);
        }
      }
    } catch(e) {
      console.error('Vercel API error:', e.message);
    }
  }

  const domainVerified = dnsOk || rootDomainOk || vercelConfirmed;

  // ── NOT VERIFIED — return specific guidance based on what we found ──────────
  if (!domainVerified) {

    // Priority 1: Cloudflare orange cloud is the issue
    if (isCloudflareProxy) {
      return res.status(200).json({
        verified:        false,
        domain:          clean,
        dnsOk:           false,
        cloudflareProxy: true,
        isRoot,
        recordType:      isRoot ? 'A' : 'CNAME',
        reason:          'Cloudflare proxy (orange cloud) is intercepting your domain and blocking Vercel SSL.',
        guidance:        'Your domain is going through Cloudflare proxy.',
        action:          'In Cloudflare DNS settings, find the record for ' + clean + ' and click the orange cloud to turn it grey (DNS Only). Save, wait 2 minutes, then verify again.',
        dnsRecords:      uniqueAnswers,
        vercelData:      vercelDomainData,
      });
    }

    // Priority 2: Root domain pointing somewhere wrong
    if (isRoot && uniqueAnswers.length > 0 && !hasVercelA && !hasCname) {
      return res.status(200).json({
        verified:   false,
        domain:     clean,
        dnsOk:      false,
        isRoot,
        recordType: 'A',
        reason:     'Root domain found but not pointing to Vercel.',
        guidance:   'Your domain currently points to: ' + uniqueAnswers.slice(0, 2).join(', '),
        action:     'Delete the existing A record and add a new A record: Name = @, Value = 76.76.21.21. Save and wait 30 minutes.',
        dnsRecords: uniqueAnswers,
        vercelData: vercelDomainData,
      });
    }

    // Priority 3: Root domain with no records at all
    if (isRoot && uniqueAnswers.length === 0) {
      return res.status(200).json({
        verified:   false,
        domain:     clean,
        dnsOk:      false,
        isRoot,
        recordType: 'A',
        reason:     'No DNS records found for this root domain yet.',
        guidance:   'No A record found for ' + clean + '.',
        action:     'Add an A record (not CNAME): Name = @, Value = 76.76.21.21. Wait 30 minutes to 2 hours, then verify again. Up to 24 hours is normal.',
        dnsRecords: uniqueAnswers,
        vercelData: vercelDomainData,
      });
    }

    // Priority 4: Subdomain pointing somewhere wrong
    let hint = '';
    if (uniqueAnswers.length && !uniqueAnswers.some(a => a.includes('vercel'))) {
      hint = 'Your domain currently points to: ' + uniqueAnswers.slice(0, 2).join(', ') + '. Change the CNAME value to: cname.vercel-dns.com';
    } else if (uniqueAnswers.length === 0) {
      hint = '.' + tld + ' domains can take longer to propagate. Wait 30 minutes to 2 hours and try again. Up to 24 hours is normal.';
    } else {
      hint = 'Records are propagating. Wait 30 minutes and try again.';
    }

    return res.status(200).json({
      verified:   false,
      domain:     clean,
      dnsOk:      false,
      isRoot,
      recordType: 'CNAME',
      reason:     `CNAME record not verified yet. Name = ${host}, Value = cname.vercel-dns.com.`,
      guidance:   uniqueAnswers.length ? 'DNS records found: ' + uniqueAnswers.slice(0, 2).join(', ') : 'No DNS records found yet.',
      action:     hint,
      dnsRecords: uniqueAnswers,
      vercelData: vercelDomainData,
    });
  }

  // ── VERIFIED — save to Firestore ────────────────────────────────────────────
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
      console.error('Firestore save error:', e.message);
    }
  }

  return res.status(200).json({
    verified:   true,
    domain:     clean,
    dnsOk:      true,
    isRoot,
    recordType: isRoot ? 'A' : 'CNAME',
    firestoreOk,
    funnelUrl:  `https://${clean}`,
    reason:     `Domain connected. Your funnel is live at https://${clean}`,
    dnsRecords: uniqueAnswers,
  });
};
