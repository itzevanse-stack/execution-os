// api/email-setup.js — manages member Resend accounts for email sending
// Validates API keys, adds domains, retrieves DNS records, checks verification
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, apiKey, domain, domainId } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });

  // ── VALIDATE KEY ──────────────────────────────────────────────────────────────
  if (action === 'validate-key') {
    if (!apiKey || !apiKey.startsWith('re_')) {
      return res.status(400).json({ valid: false, error: 'Invalid API key format' });
    }
    try {
      // Hit Resend's API keys endpoint to validate
      const resp = await fetch('https://api.resend.com/api-keys', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const valid = resp.status === 200 || resp.status === 403; // 403 = valid key, no list permission
      return res.status(200).json({ valid });
    } catch(e) {
      // If network error, trust the key format
      return res.status(200).json({ valid: true, note: 'Could not verify key online' });
    }
  }

  // ── ADD DOMAIN ────────────────────────────────────────────────────────────────
  if (action === 'add-domain') {
    if (!apiKey || !domain) return res.status(400).json({ error: 'Missing apiKey or domain' });

    try {
      const resp = await fetch('https://api.resend.com/domains', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        // Domain might already exist — try to get its records
        if (data.name === 'already_exists' || (data.message && data.message.includes('already'))) {
          // Fetch existing domain list to get its ID
          const listResp = await fetch('https://api.resend.com/domains', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          const listData = await listResp.json();
          const existing = (listData.data || []).find(d => d.name === domain);
          if (existing) {
            // Get the domain records
            const detailResp = await fetch(`https://api.resend.com/domains/${existing.id}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const detail = await detailResp.json();
            return res.status(200).json({
              domainId: existing.id,
              records:  formatRecords(detail.records || []),
              note:     'Domain already exists in your Resend account',
            });
          }
        }
        return res.status(400).json({ error: data.message || data.name || 'Could not add domain' });
      }

      return res.status(200).json({
        domainId: data.id,
        records:  formatRecords(data.records || []),
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── VERIFY DOMAIN ─────────────────────────────────────────────────────────────
  if (action === 'verify-domain') {
    if (!apiKey || (!domain && !domainId)) return res.status(400).json({ error: 'Missing apiKey and domain/domainId' });

    try {
      let id = domainId;

      // If no domainId, look up domain by name
      if (!id && domain) {
        const listResp = await fetch('https://api.resend.com/domains', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const listData = await listResp.json();
        const found = (listData.data || []).find(d => d.name === domain);
        if (found) id = found.id;
      }

      if (!id) return res.status(404).json({ verified: false, reason: 'Domain not found in your Resend account. Add it first.' });

      // Check domain status
      const resp = await fetch(`https://api.resend.com/domains/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await resp.json();

      const verified = data.status === 'verified';

      // Also check individual records for diagnostics
      const records  = data.records || [];
      const failures = records.filter(r => r.status !== 'verified').map(r => r.record_type || r.type);

      return res.status(200).json({
        verified,
        status:  data.status,
        reason:  verified
          ? 'Domain fully verified. SPF, DKIM, and DMARC are active.'
          : failures.length
            ? `Still waiting on: ${failures.join(', ')} records. DNS can take up to 48 hours.`
            : 'Still pending. Check that all DNS records were added correctly.',
        records: formatRecords(records),
      });
    } catch(e) {
      return res.status(500).json({ verified: false, error: e.message });
    }
  }

  // ── SEND EMAIL with HTML template + tracking ──────────────────────────────
  if (action === 'send') {
    const { from, to, subject, text, html, userId, broadcastId, contactName } = req.body;
    if (!apiKey || !from || !to || !subject) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const recipientEmail = Array.isArray(to) ? to[0] : to;
    const firstName = (contactName || recipientEmail.split('@')[0]).split(' ')[0];

    // ── Personalise text ─────────────────────────────────────────────────────
    const personalised = (text || '').replace(/{{first_name}}/gi, firstName).replace(/{{name}}/gi, contactName || firstName);

    // ── Build unsubscribe URL ─────────────────────────────────────────────────
    const baseUrl    = 'https://build.skillslibry.com';
    const unsubUrl   = userId
      ? `${baseUrl}/api/unsubscribe?uid=${userId}&email=${encodeURIComponent(recipientEmail)}&bid=${broadcastId||''}`
      : `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;

    // ── Track links in the text ───────────────────────────────────────────────
    // Wrap all https:// links for click tracking (Resend does this natively when configured)
    // We also inject broadcastId and userId as tags for the webhook

    // ── Build responsive HTML email ───────────────────────────────────────────
    const bodyLines = personalised.split('\n').map(line => {
      if (!line.trim()) return '<br>';
      // Convert plain URLs to links
      return '<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1a1a1a">' +
        line.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#0066cc;text-decoration:underline">$1</a>') +
        '</p>';
    }).join('');

    const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;padding:20px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr><td style="padding:24px 40px 20px;border-bottom:1px solid #f0f0f0">
          <p style="margin:0;font-size:13px;color:#888;font-weight:600">From Evan SE · Execution OS</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px 24px">
          ${bodyLines}
        </td></tr>

        <!-- Signature -->
        <tr><td style="padding:0 40px 24px;border-top:1px solid #f0f0f0">
          <p style="margin:16px 0 4px;font-size:14px;color:#1a1a1a"><strong>Evan SE</strong></p>
          <p style="margin:0;font-size:13px;color:#888">Founder, Execution OS</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 40px 24px;background:#fafafa;border-top:1px solid #eeeeee">
          <p style="margin:0;font-size:11px;color:#aaa;line-height:1.6;text-align:center">
            You received this because you joined Execution OS.<br>
            <a href="${unsubUrl}" style="color:#888;text-decoration:underline">Unsubscribe</a> · 
            <a href="https://build.skillslibry.com" style="color:#888;text-decoration:underline">Execution OS</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      const payload = {
        from,
        to:      Array.isArray(to) ? to : [to],
        subject,
        text:    personalised + `\n\n---\nUnsubscribe: ${unsubUrl}`,
        html:    htmlBody,
      };

      // Add tags for webhook tracking
      if (userId || broadcastId) {
        payload.tags = [
          ...(userId      ? [{ name: 'userId',      value: userId }]      : []),
          ...(broadcastId ? [{ name: 'broadcastId', value: broadcastId }] : []),
        ];
      }

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data.message || 'Send failed' });
      return res.status(200).json({ success: true, id: data.id });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
};

function formatRecords(records) {
  return records.map(r => ({
    type:  r.record_type || r.type || 'TXT',
    name:  r.name || r.record || '',
    value: r.value || r.data || r.content || '',
    ttl:   r.ttl || 'Auto',
    status: r.status || 'pending',
  }));
}
