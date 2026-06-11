import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// Firebase init
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  // Vercel cron passes GET — also allow POST for manual trigger
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security: verify cron secret if set
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || req.query.secret;
    if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now     = Date.now();
  const results = { sent: 0, failed: 0, skipped: 0 };

  try {
    // Find all pending queue items due to send
    const snap = await db.collection('sequence_queue')
      .where('status', '==', 'pending')
      .where('sendAt', '<=', now)
      .limit(50) // process max 50 per run to stay within timeout
      .get();

    if (snap.empty) {
      return res.status(200).json({ message: 'No pending emails', ...results });
    }

    for (const doc of snap.docs) {
      const item = doc.data();

      // Double-check not already sent (race condition guard)
      if (item.status !== 'pending') { results.skipped++; continue; }

      // Mark as processing immediately to prevent duplicate sends
      await doc.ref.update({ status: 'processing', processingAt: FieldValue.serverTimestamp() });

      try {
        // Use the user's own Resend key if available, fall back to platform key
        const apiKey = item.resendKey || process.env.RESEND_API_KEY;
        if (!apiKey) throw new Error('No Resend API key available');

        const resend = new Resend(apiKey);

        // Personalise subject and body
        const firstName  = (item.leadName || 'there').split(' ')[0];
        const subject    = (item.stepSubject || 'Following up from Execution OS')
          .replace(/\{\{first_name\}\}/gi, firstName)
          .replace(/\{\{name\}\}/gi, item.leadName || 'there');

        const bodyText   = (item.stepBody || '')
          .replace(/\{\{first_name\}\}/gi, firstName)
          .replace(/\{\{name\}\}/gi, item.leadName || 'there');

        // Build HTML email
        const html = buildSequenceEmail(firstName, subject, bodyText);

        await resend.emails.send({
          from:    `${item.senderName || 'Execution OS'} <${item.senderEmail || 'hello@executionos.com'}>`,
          to:      item.leadEmail,
          subject: subject,
          html:    html,
        });

        // Mark as sent
        await doc.ref.update({
          status: 'sent',
          sentAt: FieldValue.serverTimestamp(),
        });

        results.sent++;
        console.log(`[sequence-cron] ✅ Sent step ${item.stepIndex} to ${item.leadEmail}`);

      } catch (sendErr) {
        console.error(`[sequence-cron] ❌ Failed for ${item.leadEmail}:`, sendErr.message);

        await doc.ref.update({
          status:      'failed',
          failedAt:    FieldValue.serverTimestamp(),
          failReason:  sendErr.message,
          retryCount:  (item.retryCount || 0) + 1,
        });

        results.failed++;
      }
    }

    return res.status(200).json({
      message: `Processed ${snap.size} items`,
      ...results,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[sequence-cron] Fatal error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Build HTML email from plain text body ─────────────────────────────────────
function buildSequenceEmail(firstName, subject, body) {
  // Convert line breaks to HTML paragraphs
  const paragraphs = body
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p style="font-size:15px;color:rgba(255,255,255,.65);line-height:1.85;margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:48px 24px;">

    <div style="text-align:center;margin-bottom:36px;">
      <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:.04em;">
        Execution<span style="color:#F5C842;">OS</span>
      </div>
    </div>

    <div style="background:#111111;border:1px solid rgba(245,200,66,.15);border-radius:20px;padding:40px 36px;">
      <div style="position:relative;overflow:hidden;">
        <div style="height:2px;background:linear-gradient(90deg,transparent,#F5C842,transparent);margin-bottom:32px;border-radius:2px;"></div>
        ${paragraphs || `<p style="font-size:15px;color:rgba(255,255,255,.65);line-height:1.85;margin:0 0 16px;">Hi ${firstName}, just following up to make sure you got everything you need.</p>`}
      </div>
    </div>

    <div style="text-align:center;margin-top:28px;">
      <p style="font-size:11px;color:rgba(255,255,255,.18);line-height:1.8;margin:0;">
        You received this because you opted in at ExecutionOS.com<br>
        &copy; ${new Date().getFullYear()} Execution OS. All rights reserved.
      </p>
    </div>

  </div>
</body>
</html>`;
}
