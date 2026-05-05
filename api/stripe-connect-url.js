// api/stripe-connect-url.js — returns Stripe Connect OAuth URL
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;

  if (!STRIPE_CLIENT_ID) {
    // Stripe Connect not configured yet — return null so app falls back to manual key entry
    return res.status(200).json({ url: null, reason: 'Stripe Connect not configured' });
  }

  const { funnelId } = req.body || {};
  const redirectUri = process.env.STRIPE_REDIRECT_URI ||
    'https://execution-os-xi.vercel.app/api/stripe-callback';

  const state = funnelId ? encodeURIComponent(funnelId) : 'connect';

  const url = 'https://connect.stripe.com/oauth/authorize'
    + '?response_type=code'
    + '&client_id=' + STRIPE_CLIENT_ID
    + '&scope=read_write'
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + state;

  return res.status(200).json({ url });
};
