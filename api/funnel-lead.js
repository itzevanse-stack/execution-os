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

  const { name, email, source = 'unknown', page = 'unknown' } = req.body || {};

  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  try {
    // 1. Save to Firestore
    await db.collection('leads').add({
      name,
      email,
      source,
      page,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 2. Send welcome email via Resend
    await resend.emails.send({
      from: 'Execution OS <hello@executionos.com>',
      to:   email,
      subject: `${name}, your free access is ready — watch this now`,
      html: buildEmail(name),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[funnel-lead] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildEmail(name) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:48px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:36px;">
      <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:.04em;">
        Execution<span style="color:#F5C842;">OS</span>
      </div>
    </div>

    <!-- Card -->
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

      <!-- CTA Button -->
      <a href="https://build.skillslibrary.com/partnership" style="display:inline-block;background:linear-gradient(135deg,#F5C842,#f59e0b);color:#080808;font-size:16px;font-weight:900;padding:18px 48px;border-radius:12px;text-decoration:none;letter-spacing:.02em;margin-bottom:20px;">
        Watch The Free Video Now →
      </a>

      <p style="font-size:13px;color:rgba(255,255,255,.3);margin:0 0 28px;line-height:1.6;">
        The video is free. It's waiting for you.<br>The only question is whether you'll watch it.
      </p>

      <!-- Divider -->
      <div style="border-top:1px solid rgba(255,255,255,.07);margin:0 0 24px;"></div>

      <p style="font-size:13px;color:rgba(255,255,255,.4);line-height:1.8;margin:0;">
        Most people who opt in never watch it.<br>
        They stay exactly where they are — stuck, waiting for something to change.<br>
        <strong style="color:rgba(255,255,255,.65);">Don't be that person, ${name}.</strong>
      </p>

    </div>

    <!-- Footer -->
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
