// api/email-setup.js — platform-managed email sending for Email Marketing
// Every user verifies their OWN sending domain (DNS records at their registrar),
// but all sending goes through ONE Resend account (this platform's), matching
// how Systeme.io and similar tools work. No user ever sees or touches an API key.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { Resend }                         from 'resend';

// ── Firebase init ─────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db     = getFirestore();
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, domain, domainId, userId } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });

  // ── ADD DOMAIN ────────────────────────────────────────────────────────────────
  // Adds the domain to the platform's Resend account, and records which user owns
  // it in Firestore so verify/send can later confirm the right person controls it.
  if (action === 'add-domain') {
    if (!domain || !userId) return res.status(400).json({ error: 'Missing domain or userId' });

    try {
      const { data, error } = await resend.domains.create({ name: domain });

      if (error) {
        // Domain might already exist on the platform account
        if (String(error.message || '').toLowerCase().includes('already')) {
          const { data: list } = await resend.domains.list();
          const existing = (list?.data || []).find(d => d.name === domain);
          if (existing) {
            const owner = await getDomainOwner(existing.id);
            if (owner && owner !== userId) {
              return res.status(409).json({ error: 'This domain is already verified by another account. If this is your domain, contact support.' });
            }
            await saveDomainOwner(existing.id, domain, userId);
            const { data: detail } = await resend.domains.get(existing.id);
            return res.status(200).json({
              domainId: existing.id,
              dnsRecords: formatRecords(detail?.records || []),
              note: 'Domain already exists on the platform — DNS records below.',
            });
          }
        }
        return res.status(400).json({ error: error.message || 'Could not add domain' });
      }

      await saveDomainOwner(data.id, domain, userId);
      return res.status(200).json({
        domainId: data.id,
        dnsRecords: formatRecords(data.records || []),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── VERIFY DOMAIN ─────────────────────────────────────────────────────────────
  if (action === 'verify-domain') {
    if (!userId || (!domain && !domainId)) return res.status(400).json({ error: 'Missing userId and domain/domainId' });

    try {
      let id = domainId;
      if (!id && domain) {
        const ownerDoc = await db.collection('emailDomains').where('domain', '==', domain).where('userId', '==', userId).limit(1).get();
        if (!ownerDoc.empty) id = ownerDoc.docs[0].id;
      }
      if (!id) return res.status(404).json({ verified: false, reason: 'Domain not found. Add it first.' });

      // Confirm this user actually owns this domain before revealing/changing anything
      const owner = await getDomainOwner(id);
      if (owner && owner !== userId) {
        return res.status(403).json({ verified: false, reason: 'You do not have access to this domain.' });
      }

      // Trigger a fresh DNS recheck, then poll status — verify() is async and
      // doesn't return the result directly, so we follow it with get()
      await resend.domains.verify(id);
      const { data, error } = await resend.domains.get(id);
      if (error) return res.status(400).json({ verified: false, reason: error.message });

      const verified = data.status === 'verified';
      const records  = data.records || [];
      const failures = records.filter(r => r.status !== 'verified').map(r => r.record_type || r.type);

      if (verified) {
        await db.collection('emailDomains').doc(id).set({ verified: true, verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      return res.status(200).json({
        verified,
        status: data.status,
        reason: verified
          ? 'Domain fully verified. SPF, DKIM, and DMARC are active.'
          : failures.length
            ? `Still waiting on: ${failures.join(', ')} records. DNS can take up to 48 hours.`
            : 'Still pending. Check that all DNS records were added correctly.',
        dnsRecords: formatRecords(records),
      });
    } catch (e) {
      return res.status(500).json({ verified: false, error: e.message });
    }
  }

  // ── SEND EMAIL ────────────────────────────────────────────────────────────────
  if (action === 'send') {
    const { from, to, subject, text, html, broadcastId, contactName } = req.body;
    if (!from || !to || !subject || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Enforce server-side that the sender's domain actually belongs to this user
    // and is verified — never trust the client's word for this.
    const fromEmail     = (from.match(/<([^>]+)>/) || [, from])[1].trim();
    const fromDomain    = fromEmail.split('@')[1] || '';
    const domainSnap    = await db.collection('emailDomains').where('domain', '==', fromDomain).where('userId', '==', userId).limit(1).get();
    if (domainSnap.empty || !domainSnap.docs[0].data().verified) {
      return res.status(403).json({ error: 'Sending domain is not verified for this account.' });
    }

    const recipientEmail = Array.isArray(to) ? to[0] : to;
    const firstName = (contactName || recipientEmail.split('@')[0]).split(' ')[0];

    const personalised = (text || '').replace(/{{first_name}}/gi, firstName).replace(/{{name}}/gi, contactName || firstName);

    const baseUrl  = 'https://build.skillslibry.com';
    const unsubUrl = userId
      ? `${baseUrl}/api/unsubscribe?uid=${userId}&email=${encodeURIComponent(recipientEmail)}&bid=${broadcastId || ''}`
      : `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;

    const bodyHtml = html || personalised.split('\n').map(line => {
      if (!line.trim()) return '<br>';
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
        <tr><td style="padding:24px 40px 20px;border-bottom:1px solid #f0f0f0">
          <p style="margin:0;font-size:13px;color:#888;font-weight:600">${escapeHtml(from)}</p>
        </td></tr>
        <tr><td style="padding:32px 40px 24px">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 40px 24px;background:#fafafa;border-top:1px solid #eeeeee">
          <p style="margin:0;font-size:11px;color:#aaa;line-height:1.6;text-align:center">
            <a href="${unsubUrl}" style="color:#888;text-decoration:underline">Unsubscribe</a>
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
        to: Array.isArray(to) ? to : [to],
        subject,
        text: personalised + `\n\n---\nUnsubscribe: ${unsubUrl}`,
        html: htmlBody,
      };
      if (userId || broadcastId) {
        payload.tags = [
          ...(userId      ? [{ name: 'userId',      value: userId }]      : []),
          ...(broadcastId ? [{ name: 'broadcastId', value: broadcastId }] : []),
        ];
      }

      const { data, error } = await resend.emails.send(payload);
      if (error) return res.status(400).json({ error: error.message || 'Send failed' });
      return res.status(200).json({ success: true, id: data.id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getDomainOwner(domainId) {
  const doc = await db.collection('emailDomains').doc(domainId).get();
  return doc.exists ? doc.data().userId : null;
}

async function saveDomainOwner(domainId, domain, userId) {
  await db.collection('emailDomains').doc(domainId).set({
    domain,
    userId,
    verified:  false,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function formatRecords(records) {
  return records.map(r => ({
    type:   r.record_type || r.type || 'TXT',
    name:   r.name || r.record || '',
    value:  r.value || r.data || r.content || '',
    ttl:    r.ttl || 'Auto',
    status: r.status || 'pending',
  }));
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
