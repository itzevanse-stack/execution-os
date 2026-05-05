// api/verify-domain.js — checks if a custom domain CNAME is pointing correctly
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, funnelId } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  try {
    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT;

    if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
      // No Vercel token — do a basic DNS check via Google DNS API
      const dnsResp = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=CNAME`,
        { headers: { 'Accept': 'application/json' } }
      );
      const dnsData = await dnsResp.json();
      const answers = dnsData.Answer || [];
      const pointsToVercel = answers.some(a =>
        a.data && (a.data.includes('vercel') || a.data.includes('cname.vercel-dns.com'))
      );
      return res.status(200).json({
        verified: pointsToVercel,
        reason: pointsToVercel ? 'CNAME verified' : 'CNAME not pointing to Vercel yet',
        answers: answers.map(a => a.data)
      });
    }

    // With Vercel token — add domain to project and check status
    // First add domain to project
    const addResp = await fetch(
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      }
    );

    // Then check domain verification status
    const checkResp = await fetch(
      `https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}`,
      { headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` } }
    );

    const checkData = await checkResp.json();
    const verified = checkData.verified === true;

    return res.status(200).json({
      verified,
      reason: verified ? 'Domain verified' : (checkData.error || 'DNS not propagated yet'),
      config: checkData.intendedNameservers || checkData.nameservers || []
    });

  } catch (err) {
    console.error('Domain verify error:', err.message);
    return res.status(500).json({ error: err.message, verified: false });
  }
};
