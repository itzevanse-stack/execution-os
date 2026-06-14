// api/unsubscribe.js
// One-click unsubscribe handler
// URL format: /api/unsubscribe?uid=USER_ID&email=EMAIL&bid=BROADCAST_ID

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';

function initFirebase() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(req, res) {
  const { uid, email, bid } = req.query || {};

  if (!uid || !email) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f9f9f9">
        <h2>Invalid unsubscribe link</h2>
        <p>This link appears to be invalid. Please reply to the email to unsubscribe.</p>
      </body></html>
    `);
  }

  try {
    initFirebase();
    const db = getFirestore();

    const emailKey = email.replace(/[.@]/g, '_');
    const timestamp = Date.now();

    // Add to suppression list
    await db.doc(`users/${uid}/suppressed/${emailKey}`).set({
      email,
      reason: 'unsubscribed',
      at:     timestamp,
    }, { merge: true });

    // Update broadcast stats
    if (bid) {
      await db.doc(`users/${uid}/broadcasts/${bid}/stats/summary`).set({
        unsubscribes: FieldValue.increment(1),
        lastUpdated:  timestamp,
      }, { merge: true });
    }

    // Update contact record
    const contactsSnap = await db.collection(`users/${uid}/contacts`)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!contactsSnap.empty) {
      await contactsSnap.docs[0].ref.update({
        unsubscribed: true,
        unsubscribedAt: timestamp,
      });
    }

    console.log('[unsubscribe] ✅ Unsubscribed:', email, 'from', uid);

    // Show confirmation page
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Unsubscribed</title>
        <style>
          * { margin:0;padding:0;box-sizing:border-box; }
          body { font-family:'Helvetica Neue',Arial,sans-serif;background:#06060f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px; }
          .card { max-width:480px;width:100%;text-align:center; }
          .icon { font-size:48px;margin-bottom:16px; }
          h1 { font-size:24px;font-weight:900;margin-bottom:10px; }
          p { font-size:14px;color:rgba(255,255,255,.6);line-height:1.7;margin-bottom:6px; }
          .email { font-size:13px;color:#4ecca3;font-weight:700;margin:12px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>You've been unsubscribed</h1>
          <p class="email">${email}</p>
          <p>You will no longer receive emails from this sender.</p>
          <p style="margin-top:16px;font-size:12px;color:rgba(255,255,255,.3)">If this was a mistake, reply to any previous email to resubscribe.</p>
        </div>
      </body>
      </html>
    `);

  } catch(e) {
    console.error('[unsubscribe] ❌ Error:', e.message);
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Something went wrong</h2>
        <p>Please reply to the email directly to unsubscribe.</p>
      </body></html>
    `);
  }
}
