// api/send-campaign.js — sends bulk email using the MEMBER'S own Resend API key
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, from, recipients, subject, text } = req.body || {};
  const RESEND_KEY = apiKey || process.env.RESEND_API_KEY;

  if (!RESEND_KEY) return res.status(400).json({ error: 'No Resend API key. Connect your Resend account in Email Settings.' });
  if (!from || !recipients || !subject || !text) return res.status(400).json({ error: 'Missing required fields' });

  const valid = (Array.isArray(recipients) ? recipients : []).filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!valid.length) return res.status(400).json({ error: 'No valid email addresses' });

  let sent = 0, errors = 0;

  try {
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50);
      const resp = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(email => ({ from, to: [email], subject, text }))),
      });
      if (resp.ok) sent += batch.length;
      else errors += batch.length;
      if (i + 50 < valid.length) await new Promise(r => setTimeout(r, 200));
    }
    return res.status(200).json({ success: true, sent, errors, total: valid.length });
  } catch(err) {
    return res.status(500).json({ error: err.message, sent });
  }
};
