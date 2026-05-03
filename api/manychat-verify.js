/**
 * Execution OS — ManyChat Verify
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

  const { apiKey } = req.body || {};
  const key = String(apiKey || '').trim();

  if (key.length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  // Confirmed working ManyChat API endpoints
  const endpoints = [
    { path: '/fb/page/getTags',         name: 'getTags'         },
    { path: '/fb/page/getGrowthTools',  name: 'getGrowthTools'  },
    { path: '/fb/page/getCustomFields', name: 'getCustomFields' },
  ];

  try {
    for (const ep of endpoints) {
      let response, text;
      try {
        response = await fetch('https://api.manychat.com' + ep.path, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Accept': 'application/json',
          },
        });
        text = await response.text();
      } catch (e) {
        console.log('Fetch error on', ep.name, ':', e.message);
        continue;
      }

      console.log(ep.name, '| HTTP:', response.status, '| Body:', text.substring(0, 200));

      if (text.trim().startsWith('<')) {
        console.log(ep.name, 'returned HTML — skipping');
        continue;
      }

      let data;
      try { data = JSON.parse(text); } catch(e) { continue; }

      if (data.status === 'success') {
        return res.status(200).json({
          ok: true,
          account: { name: 'ManyChat Account', id: null },
        });
      }

      if (data.status === 'error') {
        return res.status(200).json({
          ok: false,
          error: data.message || 'Invalid API key — check ManyChat → Settings → API',
        });
      }
    }

    return res.status(200).json({
      ok: false,
      error: 'Could not connect to ManyChat. Please regenerate your API key in ManyChat → Settings → API and try again.',
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
