/**
 * Execution OS — ManyChat Subscribers
 * Vercel Serverless Function
 *
 * POST /api/manychat-subscribers
 * Body: { apiKey: "...", lastCount: 120 }
 * Returns: { ok: true, total: 145, newSince: 25 }
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

  const { apiKey, lastCount } = req.body || {};

  if (!apiKey || apiKey.length < 20) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid API key' });
  }

  const prevCount = parseInt(lastCount) || 0;

  try {
    const mc = await fetch('https://api.manychat.com/fb/subscriber/getList?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await mc.json();

    if (data.status === 'success') {
      const total    = data.total_count || 0;
      const newSince = Math.max(0, total - prevCount);
      return res.status(200).json({ ok: true, total, newSince });
    }

    return res.status(401).json({
      ok: false,
      error: data.message || 'Could not fetch subscribers. Check your API key.',
    });

  } catch (err) {
    console.error('manychat-subscribers error:', err);
    return res.status(500).json({ ok: false, error: 'Could not reach ManyChat. Try again.' });
  }
};
