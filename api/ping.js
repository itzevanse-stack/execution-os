// api/ping.js — drop this in your api/ folder and visit /api/ping
// If you get {"ok":true} the problem is Firebase, not Vercel routing.
// If you get a 404, your api/ files aren't being deployed.

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, message: 'Vercel API is working', ts: Date.now() });
};
