/**
 * Execution OS — ManyChat Verify
 * Vercel Serverless Function (Node 18)
 * Uses native fetch which follows redirects automatically
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

  const endpoints = [
    'https://api.manychat.com/fb/account',
    'https://api.manychat.com/fb/subscriber/getList?limit=1',
  ];

  try {
    for (const url of endpoints) {
      let response, text;

      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });
        text = await response.text();
      } catch (fetchErr) {
        console.log('Fetch error for', url, ':', fetchErr.message);
        continue;
      }

      console.log('URL:', url, '| Status:', response.status, '| Body:', text.substring(0, 200));

      // Skip HTML responses
      if (text.trim().startsWith('<')) {
        console.log('Got HTML response — skipping');
        continue;
      }

      let data;
      try { data = JSON.parse(text); } catch(e) {
        console.log('JSON parse error:', e.message);
        continue;
      }

      if (data.status === 'success') {
        const name = (data.data && (data.data.name || data.data.page_name)) || 'ManyChat Account';
        return res.status(200).json({
          ok: true,
          account: { name, id: (data.data && data.data.id) || null },
        });
      }

      if (data.status === 'error') {
        return res.status(200).json({
          ok: false,
          error: data.message || 'Invalid API key — check ManyChat → Settings → API',
        });
      }
    }

    // Nothing worked
    return res.status(200).json({
      ok: false,
      error: 'Could not verify with ManyChat. Check your API key in ManyChat → Settings → API and try again.',
    });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
