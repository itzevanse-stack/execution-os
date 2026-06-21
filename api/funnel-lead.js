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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, source = 'unknown', page = 'unknown', userId, affiliateId } = req.body || {};

  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  // ── Country — Vercel attaches this on every request, no external API needed ──
  const country = req.headers['x-vercel-ip-country'] || null;

  // Normalise email
  const normEmail = email.toLowerCase().trim();

  // ── Verify the email is real and deliverable before we save anything ──────
  if (process.env.ABSTRACT_API_KEY) {
    try {
      const verifyRes = await fetch(
        `https://emailvalidation.abstractapi.com/v1/?api_key=${process.env.ABSTRACT_API_KEY}&email=${encodeURIComponent(normEmail)}`
      );
      const verifyData = await verifyRes.json();

      const deliverability = verifyData?.deliverability; // 'DELIVERABLE' | 'UNDELIVERABLE' | 'RISKY' | 'UNKNOWN'
      const isDisposable   = verifyData?.is_disposable_email?.value === true;
      const validFormat    = verifyData?.is_valid_format?.value !== false;

      if (!validFormat || isDisposable || deliverability === 'UNDELIVERABLE') {
        console.log(`[funnel-lead] Rejected email ${normEmail} — deliverability: ${deliverability}, disposable: ${isDisposable}`);
        return res.status(400).json({
          error: 'This email address looks invalid or undeliverable. Please double-check and try again.',
        });
      }
      // 'DELIVERABLE', 'RISKY', and 'UNKNOWN' (e.g. catch-all domains like Gmail/Outlook) are all allowed through —
      // only hard-block confirmed bad format, disposable addresses, or explicitly UNDELIVERABLE emails
    } catch (verifyErr) {
      // Verification service failure is non-fatal — don't block real leads over an API outage
      console.warn('[funnel-lead] Email verification check failed (non-fatal):', verifyErr.message);
    }
  }

  try {
    // Clean up affiliateId — guards against an unsubstituted template token
    // ever reaching here (e.g. {{AFFILIATE_ID}} if a page was served before
    // substitution ran), and against blank/whitespace-only values.
    const cleanAffiliateId = (affiliateId && typeof affiliateId === 'string' &&
      !affiliateId.includes('{{') && affiliateId.trim())
        ? affiliateId.trim()
        : null;

    // ── Fix 7: Deduplicate — check if this email already opted in ─────────────
    // NOTE: dedup is by email only, with no affiliate awareness. If the same
    // email opts in again later through a DIFFERENT affiliate's page, this
    // still counts as a duplicate and the lead is NOT re-attributed to the
    // second affiliate — only whichever affiliate captured it first keeps
    // the attribution. That's a commission-policy question, not changed here.
    const existing = await db.collection('leads')
      .where('email', '==', normEmail)
      .limit(1)
      .get();

    if (!existing.empty) {
      // Already in system — still unlock the page, just don't re-add or re-email
      console.log(`[funnel-lead] Duplicate opt-in ignored: ${normEmail}`);
      return res.status(200).json({ success: true, duplicate: true });
    }

    // ── 1. Save lead ──────────────────────────────────────────────────────────
    const leadRef = await db.collection('leads').add({
      name,
      email:     normEmail,
      source,
      page,
      country,
      createdAt: FieldValue.serverTimestamp(),
      ...(cleanAffiliateId ? { affiliateId: cleanAffiliateId } : {}),
    });

    // ── 2. Send Day 1 welcome email immediately ───────────────────────────────
    const emailResult = await resend.emails.send({
      from:    'Execution OS <hello@build.skillslibry.com>',
      to:      normEmail,
      subject: `${name}, your free access is ready — watch this now`,
      html:    buildWelcomeEmail(name),
    });

    if (emailResult.error) {
      console.error('[funnel-lead] Welcome email failed:', emailResult.error);
      // Non-fatal — lead is saved, continue
    }

    // ── 3. Queue sequence follow-up emails ────────────────────────────────────
    await enqueueSequenceSteps({
      name,
      email:  normEmail,
      source,
      page,
      leadId: leadRef.id,
      userId,
      affiliateId: cleanAffiliateId,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[funnel-lead] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Fix 1 + 9: Queue sequence steps — uses collectionGroup with proper error handling
// Note: requires Firestore composite index on emailMarketing.sequenceLive (collection group)
// Create at: Firebase Console → Firestore → Indexes → Add index:
//   Collection ID: emailMarketing | Field: sequenceLive ASC | Scope: Collection group
async function enqueueSequenceSteps({ name, email, source, page, leadId, userId, affiliateId }) {
  try {
    let usersToCheck = [];

    if (userId) {
      usersToCheck.push(userId);
    } else {
      // ── Fix 1: collectionGroup query — requires Firestore index ──────────
      // Index: Collection group "emailMarketing", field "sequenceLive" ASC
      try {
        const snap = await db.collectionGroup('emailMarketing')
          .where('sequenceLive', '==', true)
          .limit(20)
          .get();

        snap.forEach(doc => {
          const uid = doc.ref.parent?.parent?.id;
          if (uid) usersToCheck.push(uid);
        });
      } catch (indexErr) {
        // Index not yet created — log clearly so it's easy to diagnose
        if (indexErr.code === 9 || indexErr.message?.includes('index')) {
          console.warn('[funnel-lead] Firestore index missing for collectionGroup query.');
          console.warn('[funnel-lead] Create index: Collection group "emailMarketing", field "sequenceLive" ASC');
          console.warn('[funnel-lead] Sequence queuing skipped — lead and welcome email saved successfully.');
        } else {
          console.error('[funnel-lead] collectionGroup error:', indexErr.message);
        }
        return; // Non-fatal
      }
    }

    if (!usersToCheck.length) return;

    for (const uid of usersToCheck) {
      const emDoc = await db.doc(`users/${uid}/emailMarketing/data`).get().catch(() => null);
      if (!emDoc?.exists) continue;

      const emData    = emDoc.data();
      if (!emData?.sequenceLive) continue;

      const sequences       = emData.sequences || [];
      const sender          = emData.sender    || {};
      const connectedFunnel = emData.connectedFunnel || '';

      // Check if this opt-in matches the connected funnel
      const funnelMatches = !connectedFunnel ||
        connectedFunnel === source ||
        connectedFunnel === page   ||
        source.includes(connectedFunnel) ||
        page.includes(connectedFunnel);

      if (!funnelMatches) continue;

      // ── Fix 4: Warn clearly if no sender email configured ─────────────────
      if (!sender.email) {
        console.warn(`[funnel-lead] User ${uid} has sequenceLive=true but no sender email configured.`);
        console.warn('[funnel-lead] Sequence emails will fall back to platform Resend key and sender.');
      }

      // ── Fix 4: Use user's key if available, fall back to platform key ─────
      const resendKey   = sender.resendApiKey || process.env.RESEND_API_KEY || '';
      const senderName  = sender.name  || 'Execution OS';
      const senderEmail = sender.email || 'hello@build.skillslibry.com';

      if (!resendKey) {
        console.error(`[funnel-lead] No Resend key available for user ${uid} — sequence skipped`);
        continue;
      }

      for (const seq of sequences) {
        const emails = seq.emails || [];
        const now    = Date.now();

        for (let i = 0; i < emails.length; i++) {
          const step    = emails[i];
          const delayMs = parseDayDelay(step.delay || step.day || (i === 0 ? 0 : i * 3)) * 86400000;

          // Skip step 0 / immediate — welcome email already sent
          if (delayMs === 0) continue;

          // ── Fix 9: Use sequenceId consistently from seq.id only ──────────
          const sequenceId = seq.id || seq.name || `seq_${uid}_${i}`;

          await db.collection('sequence_queue').add({
            leadId,
            leadName:    name,
            leadEmail:   email,
            userId:      uid,
            sequenceId,
            stepIndex:   i,
            stepSubject: step.subject || `A message from Execution OS`,
            stepBody:    step.body    || step.html || step.text || '',
            senderName,
            senderEmail,
            resendKey,
            sendAt:      now + delayMs,
            status:      'pending',
            createdAt:   FieldValue.serverTimestamp(),
            source,
            page,
            ...(affiliateId ? { affiliateId } : {}),
          });

          console.log(`[funnel-lead] Queued step ${i} for ${email} — sends in ${delayMs/86400000} days`);
        }
      }
    }
  } catch (err) {
    // Non-fatal — lead and welcome email already committed
    console.error('[funnel-lead] Sequence queue error (non-fatal):', err.message);
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

// ── Day 1 welcome email ───────────────────────────────────────────────────────
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

      <div style="width:56px;height:56px;background:rgba(245,200,66,.1);border:2px solid rgba(245,200,66,.3);border-radius:50%;margin:0 auto 20px;line-height:56px;font-size:24px;text-align:center;">
        🎬
      </div>

      <h1 style="font-size:22px;font-weight:900;color:#ffffff;margin:0 0 12px;line-height:1.3;">
        ${name}, this video could change<br>everything for you.
      </h1>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 10px;">
        I don't say that lightly.
      </p>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 10px;">
        Right now, while you're reading this, ordinary people — people with no experience, no tech skills,
        no audience — are waking up to $1,000 days using the exact system in this video.
      </p>

      <p style="font-size:15px;color:rgba(255,255,255,.6);line-height:1.8;margin:0 0 28px;">
        Not because they're special. Because they watched the video and
        <strong style="color:#ffffff;">did something about it.</strong>
      </p>

      <a href="https://build.skillslibry.com/partnership"
         style="display:inline-block;background:linear-gradient(135deg,#F5C842,#f59e0b);color:#080808;
                font-size:16px;font-weight:900;padding:18px 48px;border-radius:12px;
                text-decoration:none;letter-spacing:.02em;margin-bottom:20px;">
        Watch The Free Video Now →
      </a>

      <p style="font-size:13px;color:rgba(255,255,255,.3);margin:0 0 28px;line-height:1.6;">
        The video is free. It's waiting for you.<br>
        The only question is whether you'll watch it.
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
