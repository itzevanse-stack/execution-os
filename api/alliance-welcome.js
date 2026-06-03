// api/alliance-welcome.js
// Vercel serverless function — fires on form submission
// Creates Firebase Auth account, saves to Firestore, sends emails via Resend

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// Init Firebase Admin (reuse if already initialised)
function initFirebase() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
}

// Generate a strong temporary password
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

// Welcome email HTML template
function buildWelcomeEmail(name, tier, tempPwd) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:48px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:36px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#F5C842;margin-bottom:8px;">EXECUTION OS</div>
      <div style="font-size:11px;color:rgba(255,255,255,.35);letter-spacing:1px;">ALLIANCE PARTNERSHIP</div>
    </div>

    <!-- Card -->
    <div style="background:#111100;border:1px solid rgba(245,200,66,.2);border-radius:16px;padding:40px 36px;">

      <!-- Greeting -->
      <h1 style="font-size:24px;font-weight:800;color:#ffffff;margin:0 0 8px;line-height:1.2;">
        Welcome to the Alliance, ${name}. 🎉
      </h1>
      <p style="font-size:15px;color:rgba(255,255,255,.55);line-height:1.7;margin:0 0 28px;">
        You just made the right decision. Your <strong style="color:#F5C842;">${tier} Partner</strong> account has been created and your Execution OS Affiliate Mode is ready.
      </p>

      <!-- Divider -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(245,200,66,.3),transparent);margin:0 0 28px;"></div>

      <!-- Login credentials -->
      <div style="margin-bottom:28px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.35);margin-bottom:14px;">Your Login Details</div>
        <div style="background:rgba(245,200,66,.05);border:1px solid rgba(245,200,66,.15);border-radius:10px;padding:16px 20px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:13px;color:rgba(255,255,255,.4);">Email</span>
            <span style="font-size:13px;font-weight:600;color:#ffffff;">${'[YOUR_EMAIL]'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:13px;color:rgba(255,255,255,.4);">Temporary Password</span>
            <span style="font-size:13px;font-weight:700;color:#F5C842;letter-spacing:1px;">${tempPwd}</span>
          </div>
        </div>
      </div>

      <!-- Access button -->
      <div style="text-align:center;margin-bottom:20px;">
        <a href="https://build.skillslibrary.com" style="display:inline-block;background:#F5C842;color:#080808;font-size:15px;font-weight:800;padding:16px 44px;border-radius:12px;text-decoration:none;">
          Access Your Execution OS Dashboard →
        </a>
      </div>

      <!-- Change password link -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://build.skillslibrary.com/reset-password" style="font-size:13px;color:rgba(245,200,66,.6);text-decoration:underline;">
          Set your own password here
        </a>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(245,200,66,.3),transparent);margin:0 0 24px;"></div>

      <!-- What to do next -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.35);margin-bottom:14px;">What To Do First</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#00C896;font-size:16px;font-weight:700;flex-shrink:0;">1.</span>
          <span style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.6;">Log in at build.skillslibrary.com using your email and the temporary password above.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#00C896;font-size:16px;font-weight:700;flex-shrink:0;">2.</span>
          <span style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.6;">Change your password immediately using the link above.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#00C896;font-size:16px;font-weight:700;flex-shrink:0;">3.</span>
          <span style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.6;">Go to Affiliate Mode, paste your link, and let the system build everything for you.</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:32px;">
      <p style="font-size:12px;color:rgba(255,255,255,.2);line-height:1.6;">
        Execution OS Alliance &nbsp;·&nbsp; build.skillslibrary.com<br>
        Questions? Reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// Admin notification email
function buildAdminEmail(name, email, tier) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9f9;border-radius:12px;">
      <h2 style="font-size:20px;margin:0 0 16px;">New Alliance Partner Joined 🎉</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;font-weight:600;color:#555;width:100px;">Name</td><td style="padding:8px 0;">${name}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;color:#555;">Email</td><td style="padding:8px 0;">${email}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;color:#555;">Tier</td><td style="padding:8px 0;font-weight:700;color:#d4a017;">${tier}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;color:#555;">Joined</td><td style="padding:8px 0;">${new Date().toLocaleString()}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#888;">Check your admin dashboard at build.skillslibrary.com to view all partners.</p>
    </div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, tier } = req.body;

  if (!name || !email || !tier) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    initFirebase();
    const auth = getAuth();
    const db   = getFirestore();
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. Generate temp password
    const tempPwd = tempPassword();

    // 2. Create Firebase Auth account
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password: tempPwd,
        displayName: name,
      });
    } catch (authErr) {
      // If user already exists, update instead
      if (authErr.code === 'auth/email-already-exists') {
        userRecord = await auth.getUserByEmail(email);
        await auth.updateUser(userRecord.uid, { displayName: name });
      } else {
        throw authErr;
      }
    }

    // 3. Save to Firestore — memberData (for app access)
    await db.collection('members').doc(userRecord.uid).set({
      name,
      email,
      tier,
      appMode: 'affiliate',
      role: 'partner',
      joinedAt: FieldValue.serverTimestamp(),
      source: 'alliance_signup',
    }, { merge: true });

    // 4. Save to alliance_partners collection (for admin dashboard)
    await db.collection('alliance_partners').doc(userRecord.uid).set({
      name,
      email,
      tier,
      uid: userRecord.uid,
      status: 'active',
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 5. Send welcome email to partner
    const welcomeHtml = buildWelcomeEmail(name, tier, tempPwd)
      .replace('[YOUR_EMAIL]', email);

    await resend.emails.send({
      from: 'Execution OS <evan@build.skillslibrary.com>',
      to: email,
      subject: 'Welcome to the Alliance — Your Access Is Ready',
      html: welcomeHtml,
    });

    // 6. Notify admin
    const adminHtml = buildAdminEmail(name, email, tier);
    await resend.emails.send({
      from: 'Execution OS <evan@build.skillslibrary.com>',
      to: 'evan@build.skillslibrary.com',
      subject: `New ${tier} Partner — ${name}`,
      html: adminHtml,
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Alliance welcome error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
