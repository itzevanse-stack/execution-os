/**
 * api/sync-domain.js
 *
 * Called automatically when the app loads for a logged-in user.
 * Reads ALL of the user's funnels from users/{uid}/funnels (the authoritative source)
 * and repairs published-funnels and domain-map for any live funnel with a domain.
 *
 * This fixes every broken domain mapping silently in the background.
 * Users never need to re-verify or re-publish.
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
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  try {
    const db = initFirebase();

    // Read all funnels for this user — this is the authoritative source
    const snapshot = await db.collection('users').doc(uid)
      .collection('funnels').get();

    if (snapshot.empty) {
      return res.status(200).json({ ok: true, repaired: 0, message: 'No funnels found' });
    }

    let repaired = 0;
    const writes = [];

    snapshot.forEach(function(doc) {
      const funnel = doc.data();
      if (!funnel) return;

      const domain = (funnel.domain || '').trim();
      const status = funnel.status;

      // Repair published-funnels for ALL funnels (live or not) so domain is always current
      // The status check in funnel.js handles whether to serve it
      writes.push(
        db.collection('published-funnels').doc(doc.id).set({
          id:             doc.id,
          name:           funnel.name           || '',
          type:           funnel.type           || '',
          pages:          funnel.pages          || {},
          pageOrder:      funnel.pageOrder       || [],
          pagePaths:      funnel.pagePaths       || {},
          homePage:       funnel.homePage        || '',
          domain:         domain,
          domainVerified: funnel.domainVerified  || false,
          ownerUid:       uid,
          status:         status                || 'draft',
          publishedAt:    funnel.publishedAt     || null,
        }, { merge: true })
      );

      // Repair domain-map for live funnels that have a domain
      if (domain && status === 'live') {
        const noWww   = domain.replace(/^www\./, '');
        const withWww = 'www.' + noWww;
        const record  = {
          domain:     domain,
          funnelId:   doc.id,
          uid:        uid,
          repairedAt: new Date().toISOString(),
        };
        writes.push(db.collection('domain-map').doc(domain).set(record, { merge: true }));
        writes.push(db.collection('domain-map').doc(noWww).set({ ...record, domain: noWww }, { merge: true }));
        writes.push(db.collection('domain-map').doc(withWww).set({ ...record, domain: withWww }, { merge: true }));
        repaired++;
      }
    });

    // Run all writes in parallel
    await Promise.all(writes);

    console.log('[sync-domain] Repaired', repaired, 'domain mappings for uid:', uid);
    return res.status(200).json({ ok: true, repaired });

  } catch(e) {
    console.error('[sync-domain] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
