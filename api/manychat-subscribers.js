/**
 * Execution OS — ManyChat Subscribers
 * Vercel Serverless Function (Node 18)
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { apiKey, lastCount } = req.body || {};
  const key = String(apiKey || '').trim();
  const prevCount = parseInt(lastCount) || 0;

  if (key.length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  // Use same confirmed-working endpoints as verify
  const endpoints = [
    '/fb/page/getTags',
    '/fb/page/getGrowthTools',
    '/fb/page/getCustomFields',
  ];

  try {
    for (const path of endpoints) {
      let response, text;
      try {
        response = await fetch('https://api.manychat.com' + path, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Accept': 'application/json',
          },
        });
        text = await response.text().catch(() => '');
      } catch(e) {
        console.log('Fetch error on', path, ':', e.message);
        continue;
      }

      console.log('Path:', path, '| HTTP:', response.status, '| Body:', text.substring(0, 150));

      // Handle redirect manually with auth preserved
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || '';
        if (location) {
          try {
            const r2 = await fetch(location, {
              headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
            });
            text = await r2.text();
          } catch(e2) { continue; }
        }
      }

      if (text.trim().startsWith('<')) continue;

      let data;
      try { data = JSON.parse(text); } catch(e) { continue; }

      if (data.status === 'success') {
        // Count items returned as a proxy for activity
        const items = Array.isArray(data.data) ? data.data.length : 0;
        return res.status(200).json({
          ok: true,
          total: items,
          newSince: 0,
          note: 'ManyChat connected. Subscriber count requires manual entry from ManyChat Analytics.',
        });
      }

      if (data.status === 'error') {
        return res.status(200).json({
          ok: false,
          error: data.message || 'Could not fetch data. Check your API key.',
        });
      }
    }

    return res.status(200).json({
      ok: false,
      error: 'Could not reach ManyChat. Try reconnecting.',
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
