// api/funnel-lead.js — captures opt-in submissions from published funnels
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { funnelId, uid, pageId, email, name } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  if (!funnelId) return res.status(400).json({ error: 'Missing funnelId' });

  const db  = getDb();
  const now = Date.now();
  const docId = email.toLowerCase().replace(/[^a-z0-9]/g, '-');

  const leadData = {
    email:     email.toLowerCase().trim(),
    name:      name || '',
    funnelId:  funnelId,
    pageId:    pageId || 'landing',
    source:    'funnel',
    createdAt: now,
    date:      new Date(now).toISOString().split('T')[0], // YYYY-MM-DD for easy display
  };

  try {
    const batch = db.batch();

    // 1. Save to global leads collection — shows in admin dashboard
    batch.set(db.collection('leads').doc(docId), leadData, { merge: true });

    // 2. Save to user's leads subcollection — shows in Email Marketing > Contacts
    if (uid) {
      batch.set(
        db.collection('users').doc(uid).collection('leads').doc(docId),
        leadData,
        { merge: true }
      );
    }

    await batch.commit();

    // 3. Increment funnel lead counter (separate update — can fail without breaking lead save)
    if (uid) {
      db.collection('users').doc(uid).collection('funnels').doc(funnelId)
        .update({ leads: FieldValue.increment(1) })
        .catch(() => {});
    }

    return res.status(200).json({ success: true, saved: true });
  } catch(err) {
    console.error('Funnel lead error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
