// api/send-campaign.js — sends bulk email using the member's own Resend API key
// Includes: HTML + plain text, unsubscribe link, proper headers, batching

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, from, recipients, subject, text, html, senderName, senderEmail } = req.body || {};
  const RESEND_KEY = apiKey || process.env.RESEND_API_KEY;

  if (!RESEND_KEY)  return res.status(400).json({ error: 'No Resend API key. Connect your Resend account in Email Settings.' });
  if (!from)        return res.status(400).json({ error: 'Missing from address' });
  if (!subject)     return res.status(400).json({ error: 'Missing subject line' });
  if (!text && !html) return res.status(400).json({ error: 'Missing email body' });

  const valid = (Array.isArray(recipients) ? recipients : [])
    .filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!valid.length) return res.status(400).json({ error: 'No valid email addresses' });

  // ── Build the email body ───────────────────────────────────────────────────
  const rawHtml = html || text || '';

  // Strip HTML tags for plain text version
  const plainText = rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract sender info from "Name <email>" format
  const fromMatch = from.match(/^(.+?)\s*<([^>]+)>$/) || [];
  const fromName  = senderName || fromMatch[1] || from;
  const fromEmail = senderEmail || fromMatch[2] || from;

  // ── Build proper HTML email with footer ────────────────────────────────────
  const buildHtml = (recipientEmail) => {
    // Encode email for unsubscribe link
    const encodedEmail = Buffer.from(recipientEmail).toString('base64');
    const unsubUrl     = `https://build.skillslibry.com/api/unsubscribe?e=${encodedEmail}&from=${encodeURIComponent(fromEmail)}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f5f5f5; font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 32px 16px; }
    .card { background: #ffffff; border-radius: 8px; padding: 40px 48px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .body-content { font-size: 15px; line-height: 1.85; color: #333; }
    .body-content p { margin-bottom: 16px; }
    .body-content a { color: #00b87a; font-weight: 600; }
    .body-content strong { color: #111; }
    .footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e8e8e8; font-size: 12px; color: #999; text-align: center; line-height: 1.7; }
    .footer a { color: #999; text-decoration: underline; }
    @media (max-width: 600px) { .card { padding: 28px 20px; } }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="body-content">${rawHtml}</div>
    </div>
    <div class="footer">
      <p>You received this email because you signed up at one of our pages.</p>
      <p style="margin-top:6px">
        <strong>${fromName}</strong>
        &nbsp;·&nbsp;
        <a href="mailto:${fromEmail}">${fromEmail}</a>
        &nbsp;·&nbsp;
        <a href="${unsubUrl}">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
  };

  const plainFooter = `\n\n---\nYou received this email because you signed up at one of our pages.\nFrom: ${fromName} <${fromEmail}>\nTo unsubscribe: https://build.skillslibry.com/api/unsubscribe?from=${encodeURIComponent(fromEmail)}`;

  let sent = 0, errors = 0;

  try {
    // Batch in groups of 50 with 200ms delay to stay within Resend rate limits
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50);

      const payload = batch.map(email => ({
        from:    from,
        to:      [email],
        subject: subject,
        html:    buildHtml(email),
        text:    plainText + plainFooter,
        headers: {
          'List-Unsubscribe': `<https://build.skillslibry.com/api/unsubscribe?e=${Buffer.from(email).toString('base64')}&from=${encodeURIComponent(fromEmail)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }));

      const resp = await fetch('https://api.resend.com/emails/batch', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (resp.ok) {
        sent += batch.length;
      } else {
        const errData = await resp.json().catch(() => ({}));
        console.error('Resend batch error:', errData);
        errors += batch.length;
      }

      if (i + 50 < valid.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return res.status(200).json({ success: true, sent, errors, total: valid.length });
  } catch(err) {
    console.error('send-campaign error:', err.message);
    return res.status(500).json({ error: err.message, sent });
  }
};
