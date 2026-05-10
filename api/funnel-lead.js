// api/funnel-lead.js — captures opt-in form submissions from published funnels
// Called by the tracking script injected into every served funnel page

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { funnelId, uid, pageId, email, name, ts } = req.body || {};

  if (!email || !funnelId) return res.status(400).json({ error: 'Missing email or funnelId' });

  const db = getDb();

  try {
    const now = Date.now();
    const leadData = {
      email,
      name:    name || '',
      funnelId,
      pageId:  pageId || 'unknown',
      source:  'funnel',
      createdAt: now,
    };

    // Save to global leads collection (shows in Email Marketing contacts)
    await db.collection('leads').doc(email.replace(/[^a-z0-9]/gi, '-')).set(leadData, { merge: true });

    // Save to user's leads subcollection if uid known
    if (uid) {
      await db.collection('users').doc(uid).collection('leads')
        .doc(email.replace(/[^a-z0-9]/gi, '-')).set(leadData, { merge: true });

      // Increment funnel lead counter
      await db.collection('users').doc(uid).collection('funnels').doc(funnelId)
        .update({ leads: FieldValue.increment(1) }).catch(() => {});
    }

    return res.status(200).json({ success: true });
  } catch(err) {
    console.error('Funnel lead error:', err);
    return res.status(500).json({ error: err.message });
  }
};
