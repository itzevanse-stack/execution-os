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

  console.log('Key length:', key.length, '| First 4:', key.substring(0, 4), '| Last 4:', key.substring(key.length - 4));

  if (key.length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  const endpoints = [
    '/fb/page/getTags',
    '/fb/page/getGrowthTools',
    '/fb/page/getCustomFields',
  ];

  try {
    for (const path of endpoints) {
      let response, text;
      try {
        // redirect: 'manual' stops fetch from following redirects
        // so we can see the real HTTP status and Location header
        response = await fetch('https://api.manychat.com' + path, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });

        text = await response.text().catch(() => '');
      } catch (e) {
        console.log('Fetch error on', path, ':', e.message);
        continue;
      }

      console.log(
        'Path:', path,
        '| HTTP:', response.status,
        '| Type:', response.type,
        '| Redirected to:', response.headers.get('location') || 'none',
        '| Body:', text.substring(0, 150)
      );

      // Detect redirect — this means auth header was stripped
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || 'unknown';
        console.log('Redirect detected to:', location);
        // Follow manually WITH auth header preserved
        try {
          const r2 = await fetch(location, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + key,
              'Accept': 'application/json',
            },
          });
          text = await r2.text();
          console.log('After manual redirect | HTTP:', r2.status, '| Body:', text.substring(0, 150));
        } catch(e2) {
          console.log('Manual redirect error:', e2.message);
          continue;
        }
      }

      if (text.trim().startsWith('<')) {
        console.log('Still HTML after redirect handling — skipping', path);
        continue;
      }

      let data;
      try { data = JSON.parse(text); } catch(e) {
        console.log('JSON parse error on', path, ':', e.message, '| text:', text.substring(0, 100));
        continue;
      }

      console.log('Parsed response status:', data.status);

      if (data.status === 'success') {
        return res.status(200).json({ ok: true, account: { name: 'ManyChat Account', id: null } });
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
      error: 'ManyChat API returned unexpected responses for all endpoints. Check the Vercel logs for details.',
    });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
