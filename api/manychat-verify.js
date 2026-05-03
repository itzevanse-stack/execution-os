/**
 * Execution OS — ManyChat Verify
 * Vercel Serverless Function
 *
 * POST /api/manychat-verify
 * Body: { apiKey: "..." }
 * Returns: { ok: true, account: { name, id } }
 *       or { ok: false, error: "..." }
 */

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

module.exports = async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { apiKey } = req.body || {};

  if (!apiKey || apiKey.length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  try {
    const mc = await fetch('https://api.manychat.com/fb/account', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await mc.json();

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
    console.error('manychat-verify error:', err);
    return res.status(500).json({ ok: false, error: 'Could not reach ManyChat. Try again.' });
  }
};
