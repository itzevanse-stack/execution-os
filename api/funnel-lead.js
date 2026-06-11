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

const db     = getFirestore();
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, source = 'unknown', page = 'unknown', userId } = req.body || {};

  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  try {
    // 1. Save lead to Firestore
    const leadRef = await db.collection('leads').add({
      name,
      email,
      source,
      page,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 2. Send Day 1 welcome email immediately
    await resend.emails.send({
      from:    'Execution OS <hello@executionos.com>',
      to:      email,
      subject: `${name}, your free access is ready — watch this now`,
      html:    buildWelcomeEmail(name),
    });

    // 3. Find any active sequences connected to this funnel/source
    //    Sequences are stored under each user's emailMarketing data
    //    We look for sequences where:
    //    - sequenceLive === true
    //    - connectedFunnel matches source or page
    //    - OR connectedFunnel is empty (applies to all opt-ins)
    await enqueueSequenceSteps({ name, email, source, page, leadId: leadRef.id, userId });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[funnel-lead] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Find active sequences and queue follow-up emails ─────────────────────────
async function enqueueSequenceSteps({ name, email, source, page, leadId, userId }) {
  try {
    // If userId is passed directly, only check that user's sequences
    // Otherwise scan all users' emailMarketing for live sequences
    // (platform owner is typically the only one with sequences set up)
    const usersToCheck = [];

    if (userId) {
      usersToCheck.push(userId);
    } else {
      // Find users with live sequences — check emailMarketing subcollection
      const snap = await db.collectionGroup('emailMarketing')
        .where('sequenceLive', '==', true)
        .limit(10)
        .get()
        .catch(() => null);

      if (snap) {
        snap.forEach(doc => {
          // doc.ref.parent.parent.id is the user UID
          const uid = doc.ref.parent.parent?.id;
          if (uid) usersToCheck.push(uid);
        });
      }
    }

    for (const uid of usersToCheck) {
      const emDoc = await db.doc(`users/${uid}/emailMarketing/data`).get().catch(() => null);
      if (!emDoc || !emDoc.exists) continue;

      const emData = emDoc.data();
      if (!emData.sequenceLive) continue;

      const sequences = emData.sequences || [];
      const sender    = emData.sender    || {};

      for (const seq of sequences) {
        if (!seq.live && !emData.sequenceLive) continue;

        // Check if this sequence applies to this opt-in
        const connectedFunnel = emData.connectedFunnel || '';
        const funnelMatches   = !connectedFunnel ||
                                connectedFunnel === source ||
                                connectedFunnel === page ||
                                source.includes(connectedFunnel) ||
                                page.includes(connectedFunnel);

        if (!funnelMatches) continue;

        const emails = seq.emails || [];
        const now    = Date.now();

        // Queue each email step (skip Day 1 / step 0 — already sent as welcome)
        for (let i = 0; i < emails.length; i++) {
          const step     = emails[i];
          const delayMs  = parseDayDelay(step.delay || step.day || (i === 0 ? 0 : i * 3)) * 86400000;

          // Skip immediate step — welcome email already sent above
          if (delayMs === 0) continue;

          const sendAt = now + delayMs;

          await db.collection('sequence_queue').add({
            leadId,
            leadName:    name,
            leadEmail:   email,
            userId:      uid,
            sequenceId:  seq.id || seq.name || 'default',
            stepIndex:   i,
            stepSubject: step.subject || `Follow-up from Execution OS`,
            stepBody:    step.body    || step.html || '',
            senderName:  sender.name  || 'Execution OS',
            senderEmail: sender.email || 'hello@executionos.com',
            resendKey:   sender.resendApiKey || process.env.RESEND_API_KEY || '',
            sendAt,
            status:      'pending',
            createdAt:   FieldValue.serverTimestamp(),
            source,
            page,
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal — lead and welcome email already saved
    console.error('[funnel-lead] Sequence queue error:', err.message);
  }
}

// ── Parse delay value into days ───────────────────────────────────────────────
function parseDayDelay(val) {
  if (typeof val === 'number') return val;
  const str = String(val).toLowerCase();
  if (str.includes('day'))  return parseInt(str) || 1;
  if (str.includes('hour')) return (parseInt(str) || 24) / 24;
  return parseInt(str) || 1;
}

// ── Welcome email (Day 1) ─────────────────────────────────────────────────────
function buildWelcomeEmail(name) {
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

    <div style="background:#111111;border:1px solid rgba(245,200,66,.2);border-radius:20px;padding:40px 36px;text-align:center;">

      <div style="width:56px;height:56px;background:rgba(245,200,66,.1);border:2px solid rgba(245,200,66,.3);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:56px;">
        🎬
      </div>

      <h1 style="font-size:22px;font-weight:900;color:#ffffff;margin:0 0 12px;line-height:1.3;">
        ${name}, this video could change<br>everything for you.
      </h1>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 10px;">
        I don't say that lightly.
      </p>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 10px;">
        Right now, while you're reading this, ordinary people — people with no experience, no tech skills, no audience — are waking up to $1,000 days using the exact system in this video.
      </p>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 28px;">
        Not because they're special. Because they watched the video and <strong style="color:#ffffff;">did something about it.</strong>
      </p>

      <a href="https://build.skillslibrary.com/partnership" style="display:inline-block;background:linear-gradient(135deg,#F5C842,#f59e0b);color:#080808;font-size:16px;font-weight:900;padding:18px 48px;border-radius:12px;text-decoration:none;letter-spacing:.02em;margin-bottom:20px;">
        Watch The Free Video Now →
      </a>

      <p style="font-size:13px;color:rgba(255,255,255,.3);margin:0 0 28px;line-height:1.6;">
        The video is free. It's waiting for you.<br>The only question is whether you'll watch it.
      </p>

      <div style="border-top:1px solid rgba(255,255,255,.07);margin:0 0 24px;"></div>

      <p style="font-size:13px;color:rgba(255,255,255,.4);line-height:1.8;margin:0;">
        Most people who opt in never watch it.<br>
        They stay exactly where they are — stuck, waiting for something to change.<br>
        <strong style="color:rgba(255,255,255,.65);">Don't be that person, ${name}.</strong>
      </p>

    </div>

    <div style="text-align:center;margin-top:28px;">
      <p style="font-size:11px;color:rgba(255,255,255,.18);line-height:1.8;margin:0;">
        You received this because you requested access at ExecutionOS.com<br>
        &copy; ${new Date().getFullYear()} Execution OS. All rights reserved.
      </p>
    </div>

  </div>
</body>
</html>`;
}
