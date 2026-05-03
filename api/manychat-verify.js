/**
 * Execution OS — ManyChat Verify
 * Vercel Serverless Function
 */

const https = require('https');

const ALLOWED_ORIGINS = [
  'https://execution-os-xi.vercel.app',
  'https://build.skillslibry.com',
  'http://localhost',
  'http://127.0.0.1',
];

function setCORS(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.manychat.com',
      path: url.replace('https://api.manychat.com', ''),
      method: 'GET',
      headers: headers,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Return both raw and parsed so we can debug
        try {
          resolve({ parsed: JSON.parse(data), raw: data, status: res.statusCode });
        } catch(e) {
          resolve({ parsed: null, raw: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { apiKey } = req.body || {};

  if (!apiKey || String(apiKey).trim().length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  const key = String(apiKey).trim();

  try {
    const result = await httpsGet('https://api.manychat.com/fb/account', {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    console.log('ManyChat status:', result.status);
    console.log('ManyChat raw (first 300):', result.raw.substring(0, 300));

    const data = result.parsed;

    // Could not parse — return raw for debugging
    if (!data) {
      return res.status(500).json({
        ok: false,
        error: 'ManyChat returned unexpected response',
        debug: result.raw.substring(0, 200),
        httpStatus: result.status,
      });
    }

    if (data.status === 'success' && data.data) {
      return res.status(200).json({
        ok: true,
        account: {
          name:     data.data.name     || 'ManyChat Account',
          id:       data.data.id       || null,
          timezone: data.data.timezone || null,
        },
      });
    }

    return res.status(401).json({
      ok: false,
      error: data.message || 'Invalid API key — check ManyChat → Settings → API',
      debug: JSON.stringify(data).substring(0, 200),
    });

  } catch (err) {
    console.error('manychat-verify error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
