// api/performance-summary.js — THE FEEDBACK LOOP, part 1
//
// Aggregates the user's REAL last-30-days results from the data the platform
// already collects, into one compact summary the Boardroom AI reads before
// writing any strategy:
//   - Sales + revenue        → users/{uid}/sales        (their connected Stripe)
//   - Leads captured         → leads (matched to funnels owned by this uid)
//   - Email engagement       → email_events (userId field)
//   - Content published      → calendar/{uid}/days
//
// This is what turns "AI that writes strategy" into "AI that knows this
// user's actual business."
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const now      = Date.now();
  const cutoff   = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const weekAgo  = new Date(now -  7 * 24 * 60 * 60 * 1000);

  const summary = {
    generatedAt: now,
    windowDays: 30,
    sales:   { count: 0, revenue: 0, currency: 'USD', last7Days: 0 },
    leads:   { count: 0, last7Days: 0, topSource: null },
    email:   { sent: 0, opens: 0, clicks: 0, openRate: null },
    content: { published: 0 },
    hasAnyData: false,
  };

  try {
    // ── SALES (user's own connected Stripe) ─────────────────────────────
    try {
      const salesSnap = await db.collection('users').doc(uid).collection('sales')
        .where('createdAt', '>=', cutoff).get();
      salesSnap.forEach(d => {
        const s = d.data();
        summary.sales.count++;
        summary.sales.revenue += Number(s.amount || 0);
        if (s.currency) summary.sales.currency = String(s.currency).toUpperCase();
        const ts = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate() : null;
        if (ts && ts >= weekAgo) summary.sales.last7Days++;
      });
    } catch (e) { console.warn('[performance] sales query failed:', e.message); }

    // ── LEADS (attributed to this user + grouped by content source) ─────
    try {
      // Primary: leads directly attributed via ownerUid (new capture path)
      const bySource = {};
      let matched = 0, week = 0;
      try {
        const attributedSnap = await db.collection('leads')
          .where('ownerUid', '==', uid).get();
        attributedSnap.forEach(d => {
          const l = d.data();
          const ts = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
          if (ts && ts < cutoff) return;
          matched++;
          if (ts && ts >= weekAgo) week++;
          const srcKey = l.src || l.source || 'direct';
          bySource[srcKey] = (bySource[srcKey] || 0) + 1;
        });
      } catch (e) { console.warn('[performance] attributed leads query failed:', e.message); }

      // Fallback: match by funnel name/id for older leads without ownerUid
      if (matched === 0) {
        const funnelsSnap = await db.collection('published-funnels')
          .where('ownerUid', '==', uid).get();
        const funnelKeys = new Set();
        funnelsSnap.forEach(d => {
          funnelKeys.add(d.id);
          const f = d.data();
          if (f.name) funnelKeys.add(f.name);
        });
        if (funnelKeys.size > 0) {
          const leadsSnap = await db.collection('leads')
            .where('createdAt', '>=', cutoff).get();
          leadsSnap.forEach(d => {
            const l = d.data();
            const key = l.page || l.source || '';
            if (!funnelKeys.has(key)) return;
            matched++;
            bySource[l.src || key] = (bySource[l.src || key] || 0) + 1;
            const ts = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
            if (ts && ts >= weekAgo) week++;
          });
        }
      }

      summary.leads.count = matched;
      summary.leads.last7Days = week;
      summary.leads.bySource = bySource;
      let top = null, topN = 0;
      Object.keys(bySource).forEach(k => { if (bySource[k] > topN) { top = k; topN = bySource[k]; } });
      summary.leads.topSource = top;
    } catch (e) { console.warn('[performance] leads query failed:', e.message); }

    // ── EMAIL ENGAGEMENT ────────────────────────────────────────────────
    try {
      const evSnap = await db.collection('email_events')
        .where('userId', '==', uid).get();
      evSnap.forEach(d => {
        const ev = d.data();
        const ts = ev.timestamp && ev.timestamp.toDate ? ev.timestamp.toDate()
                 : (ev.timestamp ? new Date(ev.timestamp) : null);
        if (ts && ts < cutoff) return;
        const t = String(ev.type || '').toLowerCase();
        if (t.includes('sent') || t.includes('delivered')) summary.email.sent++;
        else if (t.includes('open'))  summary.email.opens++;
        else if (t.includes('click')) summary.email.clicks++;
      });
      if (summary.email.sent > 0) {
        summary.email.openRate = Math.round((summary.email.opens / summary.email.sent) * 100) + '%';
      }
    } catch (e) { console.warn('[performance] email query failed:', e.message); }

    // ── CONTENT PUBLISHED (calendar) ────────────────────────────────────
    try {
      const daysSnap = await db.collection('calendar').doc(uid).collection('days').get();
      daysSnap.forEach(d => {
        const day = d.data() || {};
        Object.keys(day).forEach(k => {
          const v = day[k];
          if (v && typeof v === 'object' && v.status === 'published') {
            const ts = v.publishedAt ? new Date(v.publishedAt) : null;
            if (!ts || ts >= cutoff) summary.content.published++;
          }
        });
      });
    } catch (e) { console.warn('[performance] calendar query failed:', e.message); }

    summary.hasAnyData = summary.sales.count > 0 || summary.leads.count > 0
                      || summary.email.sent > 0 || summary.content.published > 0;

    return res.status(200).json(summary);
  } catch (err) {
    console.error('[performance-summary] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
