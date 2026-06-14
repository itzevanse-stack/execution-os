// api/email-track.js
// Receives webhook events from Resend for open, click, bounce, unsubscribe tracking
// Set this URL in your Resend dashboard: https://build.skillslibry.com/api/email-track

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import crypto                             from 'crypto';

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

// ── Verify Resend webhook signature ──────────────────────────────────────────
function verifySignature(rawBody, headers) {
  const secret = (process.env.RESEND_WEBHOOK_SECRET || '').replace(/^whsec_/, '');
  if (!secret) return true; // skip verification if secret not set

  const svixId        = headers['svix-id']        || '';
  const svixTimestamp = headers['svix-timestamp']  || '';
  const svixSignature = headers['svix-signature']  || '';

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Check timestamp is within 5 minutes
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign   = `${svixId}.${svixTimestamp}.${rawBody}`;
  const computed = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(toSign)
    .digest('base64');

  const expected = svixSignature.split(' ').map(s => s.replace(/^v1,/, ''));
  return expected.some(sig => sig === computed);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, svix-id, svix-timestamp, svix-signature');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Verify signature ───────────────────────────────────────────────────────
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, req.headers)) {
    console.warn('[email-track] ❌ Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ error: 'Invalid event' });

  console.log('[email-track] Event:', event.type, event.data?.email_id);

  try {
    initFirebase();
    const db = getFirestore();

    const emailId    = event.data?.email_id || event.data?.id || 'unknown';
    const recipient  = event.data?.to?.[0]  || event.data?.email || '';
    const broadcastId = event.data?.tags?.broadcastId || '';
    const userId     = event.data?.tags?.userId       || '';
    const timestamp  = Date.now();

    // ── Save event to Firestore ───────────────────────────────────────────────

    // 1. Save to global email_events collection
    await db.collection('email_events').add({
      type:        event.type,
      emailId,
      recipient,
      broadcastId,
      userId,
      timestamp,
      raw:         event.data || {},
    });

    // 2. Update broadcast stats if broadcastId exists
    if (broadcastId && userId) {
      const statsRef = db.doc(`users/${userId}/broadcasts/${broadcastId}/stats/summary`);

      const update = { lastUpdated: timestamp };

      if (event.type === 'email.opened') {
        update.opens    = FieldValue.increment(1);
        // Track unique opens
        const openRef = db.doc(`users/${userId}/broadcasts/${broadcastId}/opens/${recipient.replace(/[.@]/g,'_')}`);
        await openRef.set({ recipient, at: timestamp }, { merge: true });
      }

      if (event.type === 'email.clicked') {
        update.clicks   = FieldValue.increment(1);
        update.lastClickUrl = event.data?.click?.link || '';
        const clickRef = db.collection(`users/${userId}/broadcasts/${broadcastId}/clicks`);
        await clickRef.add({ recipient, url: event.data?.click?.link || '', at: timestamp });
      }

      if (event.type === 'email.bounced') {
        update.bounces  = FieldValue.increment(1);
        update.lastBounceType = event.data?.bounce?.type || 'hard';
        // Add to suppression list
        if (userId) {
          await db.doc(`users/${userId}/suppressed/${recipient.replace(/[.@]/g,'_')}`).set({
            email:  recipient,
            reason: 'bounce',
            type:   event.data?.bounce?.type || 'hard',
            at:     timestamp,
          }, { merge: true });
        }
      }

      if (event.type === 'email.complained') {
        update.complaints = FieldValue.increment(1);
        // Suppress immediately on complaint
        if (userId) {
          await db.doc(`users/${userId}/suppressed/${recipient.replace(/[.@]/g,'_')}`).set({
            email:  recipient,
            reason: 'complaint',
            at:     timestamp,
          }, { merge: true });
        }
      }

      if (event.type === 'email.delivery_delayed') {
        update.delayed = FieldValue.increment(1);
      }

      await statsRef.set(update, { merge: true });
    }

    // 3. Handle unsubscribe — also triggered via our /api/unsubscribe endpoint
    if (event.type === 'email.unsubscribed' && userId && recipient) {
      await db.doc(`users/${userId}/suppressed/${recipient.replace(/[.@]/g,'_')}`).set({
        email:  recipient,
        reason: 'unsubscribed',
        at:     timestamp,
      }, { merge: true });

      if (broadcastId) {
        const statsRef = db.doc(`users/${userId}/broadcasts/${broadcastId}/stats/summary`);
        await statsRef.set({ unsubscribes: FieldValue.increment(1), lastUpdated: timestamp }, { merge: true });
      }
    }

    console.log('[email-track] ✅ Event saved:', event.type, broadcastId || emailId);
    return res.status(200).json({ received: true });

  } catch(e) {
    console.error('[email-track] ❌ Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
