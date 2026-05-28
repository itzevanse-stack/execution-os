// api/verify-domain.js
// Robust DNS check that works for ALL TLDs including .site .org .io .co etc
// Added: root domain A-record detection, Cloudflare orange-cloud detection,
//        structured guidance/action fields for the UI to display specific fixes.
// Fixed: domain-map now writes even when uid is missing (funnelId alone is enough).
//        published-funnels is always updated so funnel.js can find it without uid.
//        firestoreError is returned so client can detect silent failures.

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
    '76.76.21.',
    '76.76.19.',
    '76.223.',
  ];

  const CLOUDFLARE_PROXY_PREFIXES = [
    '104.16.', '104.17.', '104.18.', '104.19.', '104.20.', '104.21.',
    '172.64.',  '172.65.',  '172.66.',  '172.67.',  '172.68.',  '172.69.',
    '172.70.',  '172.71.',
  ];

  const parts       = clean.split('.');
  const isRoot      = parts.length === 2;
  const isSubdomain = parts.length > 2;
  const host        = isSubdomain ? parts[0] : '@';
  const tld         = parts[parts.length - 1];

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

  const resolverNames = ['google', 'cloudflare', 'quad9', 'opendns'];
  const recordTypes   = ['CNAME', 'A'];
  const allQueries    = [];
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

  const isCloudflareProxy = uniqueAnswers.some(a =>
    CLOUDFLARE_PROXY_PREFIXES.some(prefix => a.startsWith(prefix))
  );

  const VERCEL_A_IPS = ['76.76.21.21', '76.76.19.61'];
  const hasVercelA   = uniqueAnswers.some(a => VERCEL_A_IPS.includes(a));
  const hasCname     = uniqueAnswers.some(a => a.includes('vercel-dns.com'));
  const rootDomainOk = isRoot && (hasVercelA || hasCname);

  let vercelDomainData = null;
  let vercelConfirmed  = false;

  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const checkRes = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${clean}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (checkRes.status === 404) {
        await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method:  'POST',
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: clean }),
          }
        );
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

  if (!domainVerified) {
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

  // ── VERIFIED — write domain-map to Firestore ─────────────────────────────────
  // FIX: uid is now OPTIONAL. funnelId alone is enough because funnel.js falls
  // back to published-funnels when uid is absent. Previously if uid was null
  // (auth not loaded) the entire write was skipped — silent failure, domain
  // never mapped, users saw "Funnel not found" even after a successful verify.
  let firestoreOk    = false;
  let firestoreError = null;

  if (funnelId) {
    try {
      const { initializeApp, getApps, cert } = require('firebase-admin/app');
      const { getFirestore }                  = require('firebase-admin/firestore');
      if (!getApps().length) {
        initializeApp({ credential: cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        })});
      }
      const db      = getFirestore();
      const noWww   = clean.replace(/^www\./, '');
      const withWww = 'www.' + noWww;
      const record  = {
        domain:     clean,
        funnelId,
        uid:        uid || null,
        verifiedAt: new Date().toISOString(),
      };

      // FIX: Read the full funnel from the user's collection so published-funnels
      // has complete data (pages, status, etc.) not just domain fields.
      // If the original client-side publish ever failed silently, published-funnels
      // may be missing or incomplete — this repairs it server-side with the
      // authoritative data from users/{uid}/funnels/{funnelId}.
      let fullFunnelData = { domain: clean, domainVerified: true, ownerUid: uid || null };
      if (uid) {
        try {
          const userFunnelSnap = await db.collection('users').doc(uid)
            .collection('funnels').doc(funnelId).get();
          if (userFunnelSnap.exists) {
            fullFunnelData = {
              ...userFunnelSnap.data(),
              domain:         clean,
              domainVerified: true,
              ownerUid:       uid,
            };
          }
        } catch(e) {
          console.warn('[verify-domain] Could not read user funnel for full write:', e.message);
          // fall through — write what we have
        }
      }

      const writes = [
        // Write all three domain variants so both www and non-www work
        db.collection('domain-map').doc(clean).set(record),
        db.collection('domain-map').doc(noWww).set({ ...record, domain: noWww }),
        db.collection('domain-map').doc(withWww).set({ ...record, domain: withWww }),
        // Write FULL funnel data so funnel.js can serve it even if client-side
        // publish-funnels write previously failed or was incomplete
        db.collection('published-funnels').doc(funnelId)
          .set(fullFunnelData, { merge: true }),
      ];

      // Also update user-scoped funnel doc if uid is available
      if (uid) {
        writes.push(
          db.collection('users').doc(uid).collection('funnels').doc(funnelId)
            .set({ domain: clean, domainVerified: true }, { merge: true })
        );
      }

      await Promise.all(writes);
      firestoreOk = true;
    } catch(e) {
      console.error('Firestore save error:', e.message);
      firestoreError = e.message;
    }
  } else {
    // No funnelId — DNS passed but we cannot map the domain to any funnel.
    // Return verified: false so the client shows an actionable error.
    return res.status(200).json({
      verified:       false,
      domain:         clean,
      dnsOk:          true,
      firestoreOk:    false,
      firestoreError: 'Missing funnel ID. Please re-open your funnel in the editor and try verifying again.',
      reason:         'DNS is correctly pointed to Vercel, but we could not link it to your funnel because the funnel ID was missing.',
      guidance:       'DNS is correctly pointed to Vercel.',
      action:         'Open your funnel in the Funnel Builder, go to the Domain step, and click Verify My Domain again.',
      dnsRecords:     uniqueAnswers,
    });
  }

  // If DNS passed but Firestore failed, tell the client explicitly
  // so they don't think they're fully set up when they're not.
  if (!firestoreOk) {
    return res.status(200).json({
      verified:       false,
      domain:         clean,
      dnsOk:          true,
      firestoreOk:    false,
      firestoreError: firestoreError || 'Unknown Firestore error',
      reason:         'DNS is correctly pointed to Vercel, but your domain could not be saved to the database. Your funnel will not be accessible at this domain yet.',
      guidance:       'DNS is correctly pointed to Vercel.',
      action:         'Wait 1 minute and click Verify again. If this keeps failing, check that your Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are set correctly in your Vercel project settings.',
      dnsRecords:     uniqueAnswers,
    });
  }

  return res.status(200).json({
    verified:    true,
    domain:      clean,
    dnsOk:       true,
    isRoot,
    recordType:  isRoot ? 'A' : 'CNAME',
    firestoreOk: true,
    funnelUrl:   `https://${clean}`,
    reason:      `Domain connected. Your funnel is live at https://${clean}`,
    dnsRecords:  uniqueAnswers,
  });
};
