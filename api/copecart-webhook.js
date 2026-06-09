/**
 * POST /api/copecart-webhook
 *
 * Receives CopeCart webhook events as CloudEvents 1.0 structured JSON.
 * Handles: cart.order.completed, payment.sale.succeeded
 *
 * On every sale:
 * 1. Saves to Firestore copecart_sales/{transactionId}
 * 2. Updates admin_stats/copecart running totals
 * 3. Sends YOU (Evan) a full sale notification email
 * 4. Looks up the referring affiliate partner and sends THEM
 *    a commission notification email
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { Resend }                         from 'resend';
import crypto                             from 'crypto';

const WEBHOOK_SECRET = process.env.COPECART_WEBHOOK_SECRET || 'EOS-Alliance-2026';
const ADMIN_EMAIL    = 'evan@build.skillslibrary.com';
const FROM_EMAIL     = 'Execution OS <evan@build.skillslibrary.com>';

function initFirebase() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })});
  }
}

function verifySignature(rawBody, headers) {
  const sig       = headers['x-cope-signature'] || null;
  const timestamp = headers['x-cope-timestamp'] || null;

  // If no signature headers present yet, accept (CopeCart may not sign all events)
  if (!sig || !timestamp) return true;

  try {
    // CopeCart signs: HMAC-SHA256 of "${timestamp}.${body}"
    const payload  = `${timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
    const actual   = sig.replace('whsec_', '').replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(actual,   'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch(e) {
    console.warn('[cope-webhook] Signature check error:', e.message, '— accepting anyway');
    return true; // fail open during testing
  }
}

const PRODUCT_ID_MAP = {
  'prod_PVMT5iF8': { tier:'Starter',  commission: 1000, type:'entry' },
  'prod_T8CKyv9B': { tier:'Pro',      commission: 2000, type:'entry' },
  'prod_tgfaj2Co': { tier:'Elite',    commission: 3000, type:'entry' },
  'prod_cyhCmvVh': { tier:'Platform', commission: 0,    type:'subscription' },
};

function detectTier(productName, amount, productId) {
  // Check product ID first — most reliable
  if (productId && PRODUCT_ID_MAP[productId]) return PRODUCT_ID_MAP[productId];
  // Fall back to name/amount
  const n   = (productName || '').toLowerCase();
  const amt = parseFloat(amount) || 0;
  if (n.includes('elite')    || amt >= 3000) return { tier:'Elite',    commission: 3000, type:'entry' };
  if (n.includes('pro')      || amt >= 2000) return { tier:'Pro',      commission: 2000, type:'entry' };
  if (n.includes('starter')  || amt >= 1000) return { tier:'Starter',  commission: 1000, type:'entry' };
  if (n.includes('platform') || amt >= 350)  return { tier:'Platform', commission: 0,    type:'subscription' };
  return { tier:'Unknown', commission: 0, type:'unknown' };
}

// ── EMAIL TEMPLATES ────────────────────────────────────────────────────────────

function adminEmail(data) {
  const { buyerName, buyerEmail, tier, amount, transactionId, affiliateName, affiliateEmail, referralSource } = data;
  return {
    subject: `💰 New ${tier} Sale — $${Number(amount).toLocaleString()} — ${buyerName}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0c0c20;border-radius:16px;overflow:hidden;border:1px solid rgba(255,217,61,.2)">
  <div style="background:linear-gradient(135deg,#ffd93d,#f59e0b);padding:20px 24px">
    <div style="font-size:22px;font-weight:900;color:#080808;font-family:Georgia,serif">Execution OS</div>
    <div style="font-size:12px;color:rgba(0,0,0,.6);margin-top:2px;letter-spacing:1px;text-transform:uppercase">New Alliance Sale</div>
  </div>
  <div style="padding:24px">
    <div style="font-size:28px;font-weight:900;color:#ffd93d;font-family:Georgia,serif;margin-bottom:4px">$${Number(amount).toLocaleString()}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px">${tier} Tier · ${new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4);width:120px">Buyer</td>
        <td style="padding:10px 0;color:#fff;font-weight:600">${buyerName}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Buyer Email</td>
        <td style="padding:10px 0;color:#fff">${buyerEmail}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Tier</td>
        <td style="padding:10px 0;color:#ffd93d;font-weight:700">${tier}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Amount</td>
        <td style="padding:10px 0;color:#4ecca3;font-weight:700">$${Number(amount).toLocaleString()}</td>
      </tr>
      ${affiliateName ? `
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Referred by</td>
        <td style="padding:10px 0;color:#6c63ff;font-weight:600">${affiliateName} (${affiliateEmail || 'no email'})</td>
      </tr>` : ''}
      ${referralSource ? `
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Source</td>
        <td style="padding:10px 0;color:rgba(255,255,255,.6)">${referralSource}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Transaction</td>
        <td style="padding:10px 0;color:rgba(255,255,255,.3);font-size:11px">${transactionId}</td>
      </tr>
    </table>
    <div style="margin-top:20px;text-align:center">
      <a href="https://build.skillslibrary.com/admin" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#ffd93d,#f59e0b);color:#080808;font-weight:900;font-size:13px;border-radius:50px;text-decoration:none;font-family:Georgia,serif">View Admin Dashboard →</a>
    </div>
  </div>
</div>`
  };
}

function affiliateEmail(data) {
  const { affiliateName, buyerName, tier, commission, platformFee, transactionId } = data;
  const firstName = (affiliateName || 'Partner').split(' ')[0];
  return {
    subject: `🎉 You just earned $${Number(commission).toLocaleString()} — New ${tier} referral!`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0c0c20;border-radius:16px;overflow:hidden;border:1px solid rgba(78,204,163,.2)">
  <div style="background:linear-gradient(135deg,#4ecca3,#38b48e);padding:20px 24px">
    <div style="font-size:22px;font-weight:900;color:#080808;font-family:Georgia,serif">Execution OS</div>
    <div style="font-size:12px;color:rgba(0,0,0,.6);margin-top:2px;letter-spacing:1px;text-transform:uppercase">Commission Earned</div>
  </div>
  <div style="padding:24px">
    <div style="font-size:15px;color:rgba(255,255,255,.7);margin-bottom:8px">Hey ${firstName},</div>
    <div style="font-size:28px;font-weight:900;color:#4ecca3;font-family:Georgia,serif;margin-bottom:4px">$${Number(commission).toLocaleString()} earned</div>
    <div style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px">Someone you referred just joined as ${tier}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4);width:140px">New member</td>
        <td style="padding:10px 0;color:#fff;font-weight:600">${buyerName}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Tier joined</td>
        <td style="padding:10px 0;color:#ffd93d;font-weight:700">${tier}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Your commission</td>
        <td style="padding:10px 0;color:#4ecca3;font-weight:900;font-size:16px">$${Number(commission).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:rgba(255,255,255,.4)">Platform fee ($197/mo)</td>
        <td style="padding:10px 0;color:rgba(255,255,255,.3);font-size:12px">Retained by Execution OS — not included in your commission</td>
      </tr>
    </table>
    <div style="margin-top:20px;padding:14px 16px;background:rgba(78,204,163,.06);border:1px solid rgba(78,204,163,.15);border-radius:12px">
      <div style="font-size:12px;color:rgba(255,255,255,.6);line-height:1.7">
        Your commission will be processed according to your CopeCart payout schedule. Log into your CopeCart account to track your earnings and payout history.
      </div>
    </div>
    <div style="margin-top:20px;text-align:center">
      <a href="https://build.skillslibrary.com/app" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4ecca3,#38b48e);color:#080808;font-weight:900;font-size:13px;border-radius:50px;text-decoration:none;font-family:Georgia,serif">Go to Your Platform →</a>
    </div>
    <div style="margin-top:16px;font-size:11px;color:rgba(255,255,255,.2);text-align:center">Execution OS Alliance · build.skillslibrary.com</div>
  </div>
</div>`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, req.headers)) {
    console.warn('[cope-webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload   = req.body;
  const eventType = payload.type || '';
  const eventId   = payload.id   || '';
  const data      = payload.data || payload;

  const SALE_EVENTS = ['cart.order.completed','payment.sale.succeeded','order.completed','payment.completed'];
  if (!SALE_EVENTS.some(e => eventType.includes(e) || eventType === e)) {
    return res.status(200).json({ ok: true, skipped: true, type: eventType });
  }

  const order  = data.order  || data.sale  || data;
  const buyer  = order.buyer || order.customer || {};
  const lines  = order.lines || order.items || [];
  const totals = order.totals || {};

  const transactionId = eventId || order.id || order.order_id || data.id || '';
  const buyerEmail    = buyer.email || data.email || '';
  const buyerName     = buyer.name  || buyer.full_name
    || (buyer.first_name ? `${buyer.first_name} ${buyer.last_name||''}`.trim() : '') || 'Unknown';

  const productName = lines.length > 0
    ? (lines[0].product?.name || lines[0].name || '')
    : (order.product_name || data.product_name || '');
  const productId = lines.length > 0
    ? (lines[0].product?.id || lines[0].product_id || '')
    : (order.product_id || '');

  const amountRaw = totals.charged?.amount || totals.total || order.amount || order.total || data.amount || 0;
  const currency  = totals.charged?.currency || order.currency || data.currency || 'USD';
  const amount    = parseFloat(amountRaw) || 0;

  if (!transactionId) return res.status(200).json({ ok: true, warning: 'No transaction ID' });

  initFirebase();
  const db     = getFirestore();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Deduplicate
  const docRef   = db.collection('copecart_sales').doc(String(transactionId));
  const existing = await docRef.get();
  if (existing.exists) return res.status(200).json({ ok: true, duplicate: true });

  const tierInfo = detectTier(productName, amount, String(productId));

  // ── Look up referring affiliate from CopeCart affiliate_id or referral data ──
  const affiliateId    = order.affiliate_id || data.affiliate_id || order.referral_id || '';
  const referralSource = order.referral_source || data.utm_source || '';
  let   affiliateName  = '';
  let   affiliateEmail = '';
  let   affiliateComm  = 0;

  if (affiliateId) {
    try {
      // Look up affiliate by CopeCart affiliate ID stored in our members collection
      const affSnap = await db.collection('members')
        .where('copeCartAffiliateId', '==', String(affiliateId))
        .limit(1).get();

      if (!affSnap.empty) {
        const affData = affSnap.docs[0].data();
        affiliateName  = affData.name  || '';
        affiliateEmail = affData.email || '';
        // Commission based on affiliate's tier and what the buyer purchased
        affiliateComm  = tierInfo.commission;
      }
    } catch(e) {
      console.warn('[cope-webhook] Affiliate lookup failed:', e.message);
    }
  }

  const saleData = {
    buyerName, buyerEmail,
    tier:          tierInfo.tier,
    amount, currency,
    productId:     String(productId),
    productName,
    transactionId: String(transactionId),
    eventType,
    status:        'paid',
    source:        'copecart',
    affiliateId:   affiliateId || null,
    affiliateName: affiliateName || null,
    affiliateEmail:affiliateEmail || null,
    affiliateComm: affiliateComm || null,
    referralSource:referralSource || null,
    createdAt:     FieldValue.serverTimestamp(),
  };

  await docRef.set(saleData);

  // Update admin stats
  await db.collection('admin_stats').doc('copecart').set({
    totalRevenue:                    FieldValue.increment(amount),
    totalSales:                      FieldValue.increment(1),
    [`tier_${tierInfo.tier}_sales`]: FieldValue.increment(1),
    [`tier_${tierInfo.tier}_rev`]:   FieldValue.increment(amount),
    lastSaleAt:                      FieldValue.serverTimestamp(),
  }, { merge: true });

  // ── Auto-add buyer to alliance_partners (so they appear in admin dashboard) ──
  if (tierInfo.tier !== 'Unknown' && tierInfo.tier !== 'Platform' && buyerEmail) {
    const safeEmail = buyerEmail.replace(/[.#$[\]]/g, '_');
    await db.collection('alliance_partners').doc(safeEmail).set({
      name:        buyerName,
      email:       buyerEmail,
      tier:        tierInfo.tier,
      status:      'active',
      amount,
      productId:   String(productId),
      transactionId: String(transactionId),
      source:      'copecart',
      affiliateId: affiliateId || null,
      joinedAt:    FieldValue.serverTimestamp(),
    }, { merge: true });

    // Also add to members collection for platform access
    await db.collection('members').doc(safeEmail).set({
      name:      buyerName,
      email:     buyerEmail,
      tier:      tierInfo.tier,
      appMode:   'affiliate',
      status:    'active',
      source:    'copecart',
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('[cope-webhook] ✅ Added to alliance_partners + members:', buyerEmail, tierInfo.tier);
  }

  if (!process.env.RESEND_API_KEY) {
    console.log('[cope-webhook] ✅ Sale recorded — no RESEND_API_KEY, emails skipped');
    return res.status(200).json({ ok: true });
  }

  // ── Send admin email ──────────────────────────────────────────────────────
  const adminTpl = adminEmail({ buyerName, buyerEmail, tier: tierInfo.tier, amount, transactionId, affiliateName, affiliateEmail, referralSource });
  await resend.emails.send({
    from: FROM_EMAIL, to: ADMIN_EMAIL,
    subject: adminTpl.subject, html: adminTpl.html,
  }).catch(e => console.warn('[cope-webhook] Admin email failed:', e.message));

  // ── Send affiliate email (if we found a referrer) ─────────────────────────
  if (affiliateEmail && affiliateComm > 0) {
    const affTpl = affiliateEmail({ affiliateName, buyerName, tier: tierInfo.tier, commission: affiliateComm, transactionId });
    await resend.emails.send({
      from: FROM_EMAIL, to: affiliateEmail,
      subject: affTpl.subject, html: affTpl.html,
    }).catch(e => console.warn('[cope-webhook] Affiliate email failed:', e.message));
    console.log(`[cope-webhook] ✅ Affiliate notified: ${affiliateName} (${affiliateEmail}) earned $${affiliateComm}`);
  }

  console.log(`[cope-webhook] ✅ ${tierInfo.tier} $${amount} — ${buyerName} — affiliate: ${affiliateName || 'direct'}`);
  return res.status(200).json({ ok: true });
}
