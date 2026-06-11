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

const db = getFirestore();

export default async function handler(req, res) {
  // Vercel cron sends GET — also allow POST for manual trigger/testing
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Security: verify cron secret ─────────────────────────────────────────
  // Add CRON_SECRET to Vercel env vars — any random string
  // Vercel passes it automatically; prevents manual external triggers
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const queryParam = req.query?.secret || '';
    const provided   = authHeader.replace('Bearer ', '') || queryParam;
    if (provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now     = Date.now();
  const results = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  try {
    // ── Fix 3: Process in batches of 50 per run (Vercel 60s timeout safe) ───
    // If queue grows beyond 50 due items, remainder is caught next hour
    const snap = await db.collection('sequence_queue')
      .where('status', '==', 'pending')
      .where('sendAt', '<=', now)
      .orderBy('sendAt', 'asc') // oldest first
      .limit(50)
      .get();

    if (snap.empty) {
      console.log('[sequence-cron] No pending emails due');
      return res.status(200).json({ message: 'No pending emails', ...results });
    }

    results.processed = snap.size;
    console.log(`[sequence-cron] Processing ${snap.size} pending emails`);

    for (const doc of snap.docs) {
      const item = doc.data();

      // ── Double-check status (race condition guard) ────────────────────────
      if (item.status !== 'pending') {
        results.skipped++;
        continue;
      }

      // ── Mark as processing BEFORE sending — prevents duplicate sends ──────
      await doc.ref.update({
        status:       'processing',
        processingAt: FieldValue.serverTimestamp(),
      });

      try {
        // ── Fix 4: Use user's own key — fall back to platform key with clear log
        const apiKey = item.resendKey || process.env.RESEND_API_KEY;

        if (!apiKey) {
          throw new Error('No Resend API key — user has not connected email and platform key not set');
        }

        // ── Fix 4: Log clearly when falling back to platform key ─────────────
        if (!item.resendKey) {
          console.warn(`[sequence-cron] Using platform Resend key for ${item.leadEmail} — user ${item.userId} has no personal key`);
        }

        const resend = new Resend(apiKey);

        // Personalise subject and body with merge tags
        const firstName      = (item.leadName || 'there').split(' ')[0];
        const personalSubject = (item.stepSubject || 'A message from Execution OS')
          .replace(/\{\{first_name\}\}/gi, firstName)
          .replace(/\{\{name\}\}/gi, item.leadName || 'there');

        const personalBody = (item.stepBody || '')
          .replace(/\{\{first_name\}\}/gi, firstName)
          .replace(/\{\{name\}\}/gi, item.leadName || 'there');

        const html = buildSequenceEmail(firstName, personalSubject, personalBody);

        const sendResult = await resend.emails.send({
          from:    `${item.senderName || 'Execution OS'} <${item.senderEmail || 'hello@executionos.com'}>`,
          to:      item.leadEmail,
          subject: personalSubject,
          html,
        });

        if (sendResult.error) {
          throw new Error(sendResult.error.message || 'Resend API error');
        }

        // ── Mark as sent ──────────────────────────────────────────────────────
        await doc.ref.update({
          status:  'sent',
          sentAt:  FieldValue.serverTimestamp(),
          emailId: sendResult.data?.id || '',
        });

        results.sent++;
        console.log(`[sequence-cron] ✅ Sent step ${item.stepIndex} (seq: ${item.sequenceId}) to ${item.leadEmail}`);

      } catch (sendErr) {
        console.error(`[sequence-cron] ❌ Failed for ${item.leadEmail} step ${item.stepIndex}:`, sendErr.message);

        const retryCount = (item.retryCount || 0) + 1;

        // ── Auto-retry up to 3 times — reschedule 1 hour later ───────────────
        if (retryCount <= 3) {
          await doc.ref.update({
            status:      'pending',
            sendAt:      now + 3600000, // retry in 1 hour
            retryCount,
            lastError:   sendErr.message,
            lastFailAt:  FieldValue.serverTimestamp(),
          });
          console.log(`[sequence-cron] Rescheduled for retry ${retryCount}/3 in 1 hour`);
        } else {
          // Give up after 3 retries — mark permanently failed
          await doc.ref.update({
            status:     'failed',
            failedAt:   FieldValue.serverTimestamp(),
            failReason: sendErr.message,
            retryCount,
          });
          console.error(`[sequence-cron] Permanently failed after 3 retries for ${item.leadEmail}`);
        }

        results.failed++;
      }
    }

    // ── Check if more items remain (Fix 3: batch size awareness) ─────────────
    const remaining = await db.collection('sequence_queue')
      .where('status', '==', 'pending')
      .where('sendAt', '<=', now)
      .limit(1)
      .get();

    const hasMore = !remaining.empty;
    if (hasMore) {
      console.warn('[sequence-cron] More than 50 items due — remainder will process next hour');
    }

    return res.status(200).json({
      message:   `Processed ${results.processed} items`,
      hasMore,
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
      <div style="height:2px;background:linear-gradient(90deg,transparent,#F5C842,transparent);margin-bottom:32px;border-radius:2px;"></div>
      ${paragraphs || `<p style="font-size:15px;color:rgba(255,255,255,.65);line-height:1.85;margin:0 0 16px;">Hi ${firstName}, just following up to make sure you got everything you need.</p>`}
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
