/**
 * POST /api/stripe-webhook
 *
 * Receives Stripe webhook events.
 * Handles: payment_intent.succeeded, checkout.session.completed
 *
 * On every successful payment:
 * 1. Saves to Firestore users/{uid}/sales/{paymentId}
 * 2. Sends sale notification email to the platform owner
 *
 * Setup:
 * 1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
 * 2. URL: https://build.skillslibry.com/api/stripe-webhook
 * 3. Events: payment_intent.succeeded, checkout.session.completed
 * 4. Copy the signing secret → add as STRIPE_WEBHOOK_SECRET in Vercel env vars
 * 5. User pastes their Stripe webhook secret in Expert Mode → Settings → Payments
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { Resend }                         from 'resend';
import crypto                             from 'crypto';

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

const FROM_EMAIL  = 'Execution OS <hello@executionos.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'evan@executionos.com';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Read raw body for signature verification ──────────────────────────────
  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  // ── Find which user this webhook belongs to ───────────────────────────────
  // Users store their Stripe webhook secret in Firestore
  // We check all expert mode users to find a matching signature
  let event    = null;
  let userId   = null;
  let whSecret = null;

  // First try platform-level secret (if set)
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      event  = verifyStripeSignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
      userId = process.env.PLATFORM_OWNER_UID || null;
    } catch(e) {}
  }

  // If not matched, scan user settings for their individual webhook secret
  if (!event) {
    try {
      const usersSnap = await db.collection('users').limit(50).get();
      for (const userDoc of usersSnap.docs) {
        const settings = await db.doc(`users/${userDoc.id}/settings/payments`).get().catch(() => null);
        if (!settings?.exists) continue;
        const data = settings.data();
        if (!data?.stripeWebhookSecret) continue;
        try {
          event  = verifyStripeSignature(rawBody, sig, data.stripeWebhookSecret);
          userId = userDoc.id;
          whSecret = data.stripeWebhookSecret;
          break;
        } catch(e) { continue; }
      }
    } catch(e) {
      console.error('[stripe-webhook] User scan error:', e.message);
    }
  }

  if (!event) {
    console.error('[stripe-webhook] No matching webhook secret found');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // ── Handle events ─────────────────────────────────────────────────────────
  try {
    if (event.type === 'payment_intent.succeeded') {
      await handlePaymentIntent(event.data.object, userId);
    } else if (event.type === 'checkout.session.completed') {
      await handleCheckoutSession(event.data.object, userId);
    } else {
      // Acknowledge but don't process
      console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch(err) {
    console.error('[stripe-webhook] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Handle payment_intent.succeeded ──────────────────────────────────────────
async function handlePaymentIntent(pi, userId) {
  const amount      = (pi.amount_received || pi.amount || 0) / 100;
  const currency    = (pi.currency || 'usd').toUpperCase();
  const paymentId   = pi.id;
  const customerEmail = pi.receipt_email || pi.metadata?.customer_email || '';
  const customerName  = pi.metadata?.customer_name || '';
  const productName   = pi.metadata?.product_name || pi.description || 'Product';
  const createdAt     = pi.created ? new Date(pi.created * 1000) : new Date();

  await saveSale({
    userId,
    paymentId,
    amount,
    currency,
    customerEmail,
    customerName,
    productName,
    processor: 'stripe',
    status:    'succeeded',
    createdAt,
    raw:       { id: pi.id, object: 'payment_intent' },
  });
}

// ── Handle checkout.session.completed ────────────────────────────────────────
async function handleCheckoutSession(session, userId) {
  const amount       = (session.amount_total || 0) / 100;
  const currency     = (session.currency || 'usd').toUpperCase();
  const paymentId    = session.payment_intent || session.id;
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const customerName  = session.customer_details?.name  || '';
  const productName   = session.metadata?.product_name || 'Product';
  const createdAt     = session.created ? new Date(session.created * 1000) : new Date();

  await saveSale({
    userId,
    paymentId,
    amount,
    currency,
    customerEmail,
    customerName,
    productName,
    processor: 'stripe',
    status:    'succeeded',
    createdAt,
    raw:       { id: session.id, object: 'checkout.session' },
  });
}

// ── Save sale to Firestore + notify ──────────────────────────────────────────
async function saveSale({ userId, paymentId, amount, currency, customerEmail, customerName, productName, processor, status, createdAt, raw }) {
  const saleData = {
    paymentId,
    amount,
    currency,
    customerEmail,
    customerName,
    productName,
    processor,
    status,
    createdAt:   FieldValue.serverTimestamp(),
    createdDate: createdAt.toISOString(),
  };

  // Save to user's own sales collection
  if (userId) {
    await db.doc(`users/${userId}/sales/${paymentId}`).set(saleData, { merge: true });

    // Update running totals
    await db.doc(`users/${userId}/stats/sales`).set({
      totalRevenue:  FieldValue.increment(amount),
      totalSales:    FieldValue.increment(1),
      lastSaleAt:    FieldValue.serverTimestamp(),
      lastSaleAmount: amount,
    }, { merge: true });
  }

  // Also save to platform-wide sales collection for admin visibility
  await db.doc(`platform_sales/${paymentId}`).set({
    ...saleData,
    userId: userId || 'unknown',
  }, { merge: true });

  console.log(`[stripe-webhook] ✅ Sale saved: $${amount} ${currency} — ${productName} — ${customerEmail}`);

  // Send notification email to admin
  try {
    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      ADMIN_EMAIL,
      subject: `💰 New Stripe Sale — $${amount.toLocaleString()} — ${productName}`,
      html:    buildSaleEmail({ amount, currency, customerEmail, customerName, productName, processor }),
    });
  } catch(emailErr) {
    console.error('[stripe-webhook] Notification email failed:', emailErr.message);
  }
}

// ── Stripe signature verification (manual, no stripe SDK needed) ──────────────
function verifyStripeSignature(rawBody, sig, secret) {
  if (!sig || !secret) throw new Error('Missing signature or secret');

  const parts     = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp  = parts.t;
  const signatures = Object.keys(parts).filter(k => k.startsWith('v')).map(k => parts[k]);

  if (!timestamp || !signatures.length) throw new Error('Invalid signature format');

  const body       = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signed     = `${timestamp}.${body}`;
  const expected   = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');

  const valid = signatures.some(s => crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')));
  if (!valid) throw new Error('Signature mismatch');

  // Check timestamp is within 5 minutes
  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) {
    throw new Error('Timestamp too old');
  }

  // Parse and return event
  const body2 = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  return JSON.parse(body2);
}

// ── Read raw body from request ────────────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  chunk => chunks.push(chunk));
    req.on('end',   ()    => resolve(Buffer.concat(chunks)));
    req.on('error', err   => reject(err));
  });
}

// ── Sale notification email ───────────────────────────────────────────────────
function buildSaleEmail({ amount, currency, customerEmail, customerName, productName, processor }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:48px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:.04em;">Execution<span style="color:#F5C842;">OS</span></div>
    </div>
    <div style="background:#111;border:1px solid rgba(78,204,163,.2);border-radius:20px;padding:36px;text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;">💰</div>
      <h1 style="font-size:24px;font-weight:900;color:#fff;margin:0 0 8px;">New Sale!</h1>
      <div style="font-size:36px;font-weight:900;color:#4ECCA3;margin-bottom:20px;">$${amount.toLocaleString()} ${currency}</div>
      <table style="width:100%;border-collapse:collapse;text-align:left;margin-bottom:20px;">
        <tr><td style="padding:8px 0;color:rgba(255,255,255,.4);font-size:12px;border-bottom:1px solid rgba(255,255,255,.06)">Product</td><td style="padding:8px 0;color:#fff;font-size:13px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.06)">${productName}</td></tr>
        <tr><td style="padding:8px 0;color:rgba(255,255,255,.4);font-size:12px;border-bottom:1px solid rgba(255,255,255,.06)">Customer</td><td style="padding:8px 0;color:#fff;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06)">${customerName || 'N/A'}</td></tr>
        <tr><td style="padding:8px 0;color:rgba(255,255,255,.4);font-size:12px">Email</td><td style="padding:8px 0;color:#fff;font-size:13px">${customerEmail || 'N/A'}</td></tr>
      </table>
      <div style="font-size:11px;color:rgba(255,255,255,.3)">via ${processor.toUpperCase()} · ${new Date().toLocaleString()}</div>
    </div>
  </div>
</body>
</html>`;
}
