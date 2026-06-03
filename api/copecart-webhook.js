// api/copecart-webhook.js
// Receives Copecart IPN on every sale
// Saves to Firestore → reports in admin dashboard

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

const WEBHOOK_SECRET = process.env.COPECART_WEBHOOK_SECRET || 'EOS-Alliance-2026';

const PRODUCT_TIERS = {
  '205c4f02': { tier: 'Starter', amount: 1000 },
  '0a72f4bd': { tier: 'Pro',     amount: 2000 },
  '25cbdc78': { tier: 'Elite',   amount: 3000 },
};

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

    // Identify tier from product ID
    const tierInfo = PRODUCT_TIERS[productId] || { tier: 'Unknown', amount: parseFloat(amountRaw) || 0 };

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
    await statsRef.set({
      totalRevenue:                    FieldValue.increment(tierInfo.amount),
      totalSales:                      FieldValue.increment(1),
      [`tier_${tierInfo.tier}_sales`]: FieldValue.increment(1),
      [`tier_${tierInfo.tier}_rev`]:   FieldValue.increment(tierInfo.amount),
      lastSaleAt:                      FieldValue.serverTimestamp(),
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
