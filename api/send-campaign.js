// api/send-campaign.js — bulk email sender via Resend
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { from, recipients, subject, text } = req.body || {};
  if (!from || !recipients || !subject || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  // Send in batches of 50 (Resend limit per call)
  const batchSize = 50;
  let sent = 0;
  const batches = [];
  for (let i = 0; i < recipients.length; i += batchSize) {
    batches.push(recipients.slice(i, i + batchSize));
  }

  try {
    for (const batch of batches) {
      await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(email => ({
          from, to: [email], subject, text,
          headers: { 'List-Unsubscribe': `<mailto:unsubscribe@${from.split('@')[1] || 'example.com'}>` }
        })))
      });
      sent += batch.length;
    }
    return res.status(200).json({ success: true, sent });
  } catch (err) {
    return res.status(500).json({ error: err.message, sent });
  }
};
