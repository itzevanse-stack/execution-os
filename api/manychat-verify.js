/**
 * Execution OS — ManyChat Verify
 * Vercel Serverless Function
 *
 * POST /api/manychat-verify
 * Body: { apiKey: "..." }
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
    const req = https.request(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from ManyChat')); }
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

  if (!apiKey || String(apiKey).length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  try {
    const data = await httpsGet('https://api.manychat.com/fb/account', {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    });

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
    });

  } catch (err) {
    console.error('manychat-verify error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
