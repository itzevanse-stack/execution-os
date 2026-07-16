// api/send-email.js — lead notification endpoint for grow.html
//
// This used to be a leftover duplicate of the old "bring your own Resend key"
// campaign sender, which meant every call from grow.html (waitlist signups
// and the apply-to-work-with-me form) was silently failing — grow.html sends
// { name, email, phone }, but the old handler expected a full campaign
// payload (apiKey, from, recipients, subject, body) and rejected everything
// with a 400 that grow.html's empty .catch() swallowed. Nobody was ever
// notified of a real lead.
//
// This rewrite: saves the lead to Firestore, then emails a notification to
// the site owner so applications and waitlist joins are actually seen.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { Resend }                         from 'resend';

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

// Where lead notifications get sent. Override with ADMIN_NOTIFY_EMAIL in
// Vercel env vars without touching code.
const NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'itzevan.se@gmail.com';
const FROM_ADDRESS  = 'Execution OS <hello@build.skillslibry.com>';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const isWaitlist  = phone === 'waitlist';
  const normEmail   = email.toLowerCase().trim();
  const displayName = (name || 'Waitlist').trim();

  try {
    // ── Save the lead ──────────────────────────────────────────────────────
    await db.collection('growLeads').add({
      name:      displayName,
      email:     normEmail,
      phone:     isWaitlist ? null : (phone || null),
      type:      isWaitlist ? 'waitlist' : 'application',
      createdAt: FieldValue.serverTimestamp(),
    });

    // ── Notify the owner ────────────────────────────────────────────────────
    const subject = isWaitlist
      ? `New waitlist signup: ${normEmail}`
      : `New application: ${displayName} wants to talk`;

    const html = isWaitlist
      ? `<p style="font-family:sans-serif;font-size:15px">New waitlist signup on the grow page:</p>
         <p style="font-family:sans-serif;font-size:15px"><strong>Email:</strong> ${escapeHtml(normEmail)}</p>`
      : `<p style="font-family:sans-serif;font-size:15px">New application submitted on the grow page:</p>
         <p style="font-family:sans-serif;font-size:15px">
           <strong>Name:</strong> ${escapeHtml(displayName)}<br>
           <strong>Email:</strong> ${escapeHtml(normEmail)}<br>
           <strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}
         </p>`;

    const emailResult = await resend.emails.send({
      from: FROM_ADDRESS,
      to:   NOTIFY_EMAIL,
      subject,
      html,
    });

    if (emailResult.error) {
      // Lead is already saved — a failed notification email shouldn't block
      // the user-facing flow (form submit / waitlist confirm) from succeeding.
      console.error('[send-email] Notification email failed:', emailResult.error);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[send-email] Error:', err.message);
    // Still return 200-ish behavior the frontend can ignore gracefully —
    // but surface the real error server-side for debugging.
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
