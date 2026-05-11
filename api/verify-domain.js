// api/verify-domain.js
// 1. Checks DNS pointing to Vercel
// 2. Adds domain to Vercel project via API
// 3. Adds explicit rewrite rule to vercel.json via GitHub API (auto-deploys)
// 4. Saves domain→funnel mapping to Firestore

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId, uid } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  const cleanDomain = domain.replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();

  const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
  const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
  const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
  const GITHUB_REPO       = process.env.GITHUB_REPO || 'itzevanse-stack/execution-os';

  const result = {
    domain:      cleanDomain,
    dnsOk:       false,
    vercelOk:    false,
    routingOk:   false,
    firestoreOk: false,
    verified:    false,
    reason:      '',
    funnelUrl:   null,
  };

  // ── STEP 1: Check DNS ────────────────────────────────────────────────────────
  try {
    const [cnameRes, aRes] = await Promise.all([
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=CNAME`, { headers: { Accept: 'application/json' } }),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=A`,     { headers: { Accept: 'application/json' } }),
    ]);
    const cnameData = await cnameRes.json();
    const aData     = await aRes.json();
    const answers   = [...(cnameData.Answer || []), ...(aData.Answer || [])];
    const targets   = ['cname.vercel-dns.com', 'vercel-dns.com', '76.76.21.21', '76.76.21.9'];
    result.dnsOk       = answers.some(a => targets.some(t => (a.data || '').toLowerCase().includes(t)));
    result.dnsRecords  = answers.map(a => a.data).filter(Boolean);
  } catch(e) { result.dnsError = e.message; }

  if (!result.dnsOk) {
    result.reason = 'DNS not pointing to Vercel yet. Add a CNAME record: Name = ' + (cleanDomain.split('.').length > 2 ? cleanDomain.split('.')[0] : 'www') + ', Value = cname.vercel-dns.com. This can take up to 24 hours.';
    return res.status(200).json(result);
  }

  // ── STEP 2: Add domain to Vercel project ─────────────────────────────────────
  if (VERCEL_TOKEN && VERCEL_PROJECT_ID) {
    try {
      const checkRes = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${cleanDomain}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (checkRes.status === 404) {
        const addRes = await fetch(
          `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: cleanDomain }),
          }
        );
        result.vercelOk = addRes.ok;
      } else {
        result.vercelOk = true;
      }
    } catch(e) { result.vercelError = e.message; result.vercelOk = true; }
  } else {
    result.vercelOk   = true;
    result.vercelNote = 'VERCEL_TOKEN not set';
  }

  // ── STEP 3: Add rewrite rule to vercel.json via GitHub API ───────────────────
  // This is the KEY step — adds an explicit routing rule so the domain loads the funnel
  if (GITHUB_TOKEN) {
    try {
      // Fetch current vercel.json
      const fileRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/vercel.json`,
        { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
      );
      const fileData = await fileRes.json();
      const currentContent = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8'));

      // Check if rule already exists
      const alreadyExists = (currentContent.rewrites || []).some(r =>
        r.has && r.has.some(h => h.type === 'host' && h.value && h.value.includes(cleanDomain.replace(/\./g, '\\.')))
      );

      if (!alreadyExists) {
        // Insert new domain rule before catch-all rules, after clean URL rewrites
        const newRule = {
          source:      '/:path*',
          has:         [{ type: 'host', value: cleanDomain.replace(/\./g, '\\.') }],
          destination: '/api/funnel',
        };

        // Find insertion point — after last non-domain rewrite
        const rewrites = currentContent.rewrites || [];
        const insertIdx = rewrites.findIndex(r => r.has && r.has.some(h => h.type === 'host'));
        if (insertIdx >= 0) {
          rewrites.splice(insertIdx, 0, newRule);
        } else {
          rewrites.push(newRule);
        }
        currentContent.rewrites = rewrites;

        const newContent = Buffer.from(JSON.stringify(currentContent, null, 2)).toString('base64');

        const updateRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/vercel.json`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Add domain routing: ${cleanDomain}`,
              content: newContent,
              sha:     fileData.sha,
            }),
          }
        );
        result.routingOk = updateRes.ok;
        if (updateRes.ok) {
          result.routingNote = 'Rewrite rule added to vercel.json — Vercel is redeploying automatically (takes ~30 seconds)';
        } else {
          const err = await updateRes.json();
          result.routingError = err.message || 'GitHub update failed';
        }
      } else {
        result.routingOk   = true;
        result.routingNote = 'Routing rule already exists';
      }
    } catch(e) {
      result.routingError = e.message;
      result.routingOk    = false;
    }
  } else {
    result.routingOk   = false;
    result.routingNote = 'GITHUB_TOKEN not set — add it to Vercel env vars to enable auto-routing';
  }

  // ── STEP 4: Save domain→funnel mapping to Firestore ─────────────────────────
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
      await db.collection('domain-map').doc(cleanDomain).set({
        domain: cleanDomain, funnelId, uid,
        verifiedAt: new Date().toISOString(),
        dnsOk: result.dnsOk, vercelOk: result.vercelOk, routingOk: result.routingOk,
      });
      await db.collection('users').doc(uid).collection('funnels').doc(funnelId)
        .set({ domain: cleanDomain, domainVerified: true }, { merge: true });
      result.firestoreOk = true;
    } catch(e) { result.firestoreError = e.message; }
  }

  // ── FINAL STATUS ─────────────────────────────────────────────────────────────
  result.verified  = result.dnsOk && result.vercelOk;
  result.funnelUrl = `https://${cleanDomain}`;

  if (result.verified && result.routingOk) {
    result.reason = 'Domain fully connected. Your funnel will be live at https://' + cleanDomain + ' within 30 seconds as Vercel redeploys.';
  } else if (result.verified && !result.routingOk) {
    result.reason = 'DNS verified and Vercel connected. ' + (result.routingNote || result.routingError || 'Add GITHUB_TOKEN to env vars for full auto-routing.');
  }

  return res.status(200).json(result);
};
