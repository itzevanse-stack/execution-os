/**
 * api/fix-domain.js
 * 
 * One-time repair endpoint.
 * Scans ALL live funnels and rebuilds domain-map correctly.
 * 
 * Visit: https://execution-os-xi.vercel.app/api/fix-domain
 * 
 * DELETE THIS FILE after running it once.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

function initFirebase() {
  if (getApps().length) return getFirestore();
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  })});
  return getFirestore();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const db = initFirebase();
    const fixed = [];
    const errors = [];

    // Read every live funnel from published-funnels
    const snapshot = await db.collection('published-funnels')
      .where('status', '==', 'live').get();

    for (const doc of snapshot.docs) {
      const funnel = doc.data();
      const rawDomain = (funnel.domain || '').trim();
      if (!rawDomain) continue;

      // Normalise — strip www. to get the canonical form
      const canonical = rawDomain.replace(/^www\./, '').toLowerCase();
      const withWww   = 'www.' + canonical;
      const uid       = funnel.ownerUid || null;
      const funnelId  = doc.id;

      const record = {
        domain:     canonical,
        funnelId:   funnelId,
        uid:        uid,
        repairedAt: new Date().toISOString(),
      };

      try {
        await Promise.all([
          // Write canonical (no-www) → funnel
          db.collection('domain-map').doc(canonical)
            .set(record, { merge: false }),
          // Write www → same funnel
          db.collection('domain-map').doc(withWww)
            .set({ ...record, domain: withWww }, { merge: false }),
          // Also normalise the domain field in published-funnels to canonical
          db.collection('published-funnels').doc(funnelId)
            .set({ domain: canonical }, { merge: true }),
        ]);
        fixed.push({ funnelId, canonical, uid });
      } catch(e) {
        errors.push({ funnelId, error: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      fixed,
      errors,
      message: `Repaired ${fixed.length} funnels. You can now delete api/fix-domain.js.`
    });

  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
