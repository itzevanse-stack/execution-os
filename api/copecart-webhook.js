// api/copecart-webhook.js
// Receives Copecart IPN on every sale
// Saves to Firestore → reports in admin dashboard

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

const WEBHOOK_SECRET = process.env.COPECART_WEBHOOK_SECRET || 'EOS-Alliance-2026';

// Payment amounts — first payment includes entry fee + first month
const PAYMENT_MAP = [
  { min: 3150, max: 3250, tier: 'Elite',   amount: 3197, type: 'entry',        label: 'Elite Entry + First Month' },
  { min: 2150, max: 2250, tier: 'Pro',     amount: 2197, type: 'entry',        label: 'Pro Entry + First Month'   },
  { min: 1150, max: 1250, tier: 'Starter', amount: 1197, type: 'entry',        label: 'Starter Entry + First Month' },
  { min: 180,  max: 210,  tier: null,      amount: 197,  type: 'subscription', label: 'Monthly Subscription'      },
];

// Subscription product IDs to identify tier on renewals
const SUBSCRIPTION_TIER_MAP = {
  '616eabaa': 'Starter',
  '0a72f4bd': 'Pro',
  '25cbdc78': 'Elite',
};

function identifyProduct(productId, amount) {
  const paid = parseFloat(amount) || 0;
  // Match by amount range first — most reliable
  const match = PAYMENT_MAP.find(p => paid >= p.min && paid <= p.max);
  if (match) {
    // For subscriptions, try to identify tier from product ID
    const tier = match.tier || SUBSCRIPTION_TIER_MAP[productId] || 'Unknown';
    return { ...match, tier };
  }
  // Fallback
  return { tier: 'Unknown', amount: paid, type: 'unknown', label: 'Unknown Payment' };
}

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    // ── Verify secret ────────────────────────────────────────────
    const incomingSecret = payload.password || payload.secret || req.headers['x-copecart-secret'];
    if (incomingSecret !== WEBHOOK_SECRET) {
      console.warn('Copecart webhook: invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── Extract buyer data from IPN payload ──────────────────────
    // Copecart IPN fields (Generic type)
    const buyerEmail    = payload.customer_email || payload.email       || '';
    const buyerName     = payload.customer_name  || payload.name        || 'Unknown';
    const productId     = payload.product_id     || payload.productId   || '';
    const transactionId = payload.transaction_id || payload.order_id    || payload.id || '';
    const amountRaw     = payload.amount         || payload.total       || 0;
    const currency      = payload.currency       || 'USD';
    const status        = payload.status         || payload.event       || 'paid';

    // Only process successful payments
    if (!['paid','completed','success','PAID','COMPLETED'].includes(status)) {
      console.log('Copecart webhook: skipping status', status);
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Identify tier and type from product ID + amount
    const tierInfo = identifyProduct(productId, amountRaw);

    initFirebase();
    const db     = getFirestore();
    const resend = new Resend(process.env.RESEND_API_KEY);

    // ── Save sale to Firestore ────────────────────────────────────
    const saleData = {
      buyerName,
      buyerEmail,
      tier:          tierInfo.tier,
      amount:        tierInfo.amount,
      currency,
      productId,
      transactionId,
      status:        'paid',
      source:        'copecart',
      createdAt:     FieldValue.serverTimestamp(),
    };

    // Avoid duplicate processing
    if (transactionId) {
      const existing = await db.collection('copecart_sales').doc(transactionId).get();
      if (existing.exists) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      await db.collection('copecart_sales').doc(transactionId).set(saleData);
    } else {
      await db.collection('copecart_sales').add(saleData);
    }

    // ── Update running totals in a stats doc ──────────────────────
    const statsRef = db.collection('admin_stats').doc('copecart');
    const isEntry  = tierInfo.type === 'entry';
    await statsRef.set({
      totalRevenue:                    FieldValue.increment(tierInfo.amount),
      totalSales:                      FieldValue.increment(1),
      [`tier_${tierInfo.tier}_sales`]: FieldValue.increment(1),
      [`tier_${tierInfo.tier}_rev`]:   FieldValue.increment(tierInfo.amount),
      // Separate entry fees from subscription renewals
      ...(isEntry
        ? { entryRevenue: FieldValue.increment(tierInfo.amount), entrySales: FieldValue.increment(1) }
        : { subscriptionRevenue: FieldValue.increment(tierInfo.amount), subscriptionRenewals: FieldValue.increment(1) }
      ),
      lastSaleAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // ── Notify admin ──────────────────────────────────────────────
    await resend.emails.send({
      from:    'Execution OS <evan@build.skillslibrary.com>',
      to:      'evan@build.skillslibrary.com',
      subject: `💰 New ${tierInfo.tier} Sale — $${tierInfo.amount} — ${buyerName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;padding:32px;background:#f9f9f9;border-radius:12px">
          <h2 style="color:#d4a017;margin:0 0 16px">New Alliance Sale 🎉</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;font-weight:600;color:#555;width:120px">Buyer</td><td>${buyerName}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Email</td><td>${buyerEmail}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Tier</td><td style="font-weight:700;color:#d4a017">${tierInfo.tier}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Amount</td><td style="font-weight:700;color:#16a34a">$${tierInfo.amount}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Transaction</td><td style="font-size:12px;color:#888">${transactionId}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Time</td><td>${new Date().toLocaleString()}</td></tr>
          </table>
          <p style="margin-top:20px;font-size:12px;color:#888">View all sales at <a href="https://build.skillslibrary.com/admin">build.skillslibrary.com/admin</a></p>
        </div>`,
    });

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Copecart webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
