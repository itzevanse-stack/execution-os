// api/funnel-view.js — tracks page views on published funnels
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
    })});
  }
  return getFirestore();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { funnelId, uid, pageId } = req.body || {};
  if (!funnelId || !uid) return res.status(200).json({ ok: true });

  try {
    const db = getDb();
    await db.collection('users').doc(uid)
      .collection('funnels').doc(funnelId)
      .update({
        views:    FieldValue.increment(1),
        lastView: Date.now(),
      });
    return res.status(200).json({ ok: true });
  } catch(e) {
    // Non-critical — don't error
    return res.status(200).json({ ok: true });
  }
};
