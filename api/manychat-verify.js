/**
 * Execution OS — ManyChat Verify
 * Vercel Serverless Function
 */

const https = require('https');

module.exports = async function handler(req, res) {
  // CORS
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

  try {
    const raw = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.manychat.com',
        path: '/fb/account',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Accept': 'application/json',
        },
      };

      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({ body, statusCode: response.statusCode }));
      });

      request.on('error', err => reject(err));
      request.setTimeout(8000, () => {
        request.destroy();
        reject(new Error('Request timed out'));
      });
      request.end();
    });

    console.log('ManyChat HTTP status:', raw.statusCode);
    console.log('ManyChat response body:', raw.body.substring(0, 500));

    let data;
    try {
      data = JSON.parse(raw.body);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: 'ManyChat returned non-JSON response',
        httpStatus: raw.statusCode,
        rawPreview: raw.body.substring(0, 300),
      });
    }

    if (data.status === 'success' && data.data) {
      return res.status(200).json({
        ok: true,
        account: {
          name: data.data.name || 'ManyChat Account',
          id:   data.data.id   || null,
        },
      });
    }

    return res.status(200).json({
      ok: false,
      error: data.message || 'Invalid API key — verify in ManyChat → Settings → API',
      mcStatus: data.status,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
