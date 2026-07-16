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

  const { uid, repairAll } = req.body || {};

  // ── ADMIN BULK REPAIR — repairAll:true ─────────────────────────────────────
  // This was called from the frontend's admin auto-repair on every admin page
  // load, but this branch never actually existed — every call hit the
  // "Missing uid" 400 below instead. Implementing it properly: scan every
  // user's funnels via a collection group query instead of one uid at a time.
  if (repairAll) {
    try {
      const db = initFirebase();
      const snapshot = await db.collectionGroup('funnels').get();
      if (snapshot.empty) {
        return res.status(200).json({ ok: true, repaired: 0, message: 'No funnels found across any user' });
      }
      let repaired = 0;
      const writes = [];
      snapshot.forEach(function(doc) {
        const funnel = doc.data();
        if (!funnel) return;
        // Collection group docs live at users/{uid}/funnels/{funnelId} — pull
        // the owning uid out of the document's parent path.
        const ownerUid = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
        if (!ownerUid) return;
        const domain = (funnel.domain || '').trim();
        const status = funnel.status;

        writes.push(
          db.collection('published-funnels').doc(doc.id).set({
            id: doc.id, name: funnel.name || '', type: funnel.type || '',
            pages: funnel.pages || {}, pageOrder: funnel.pageOrder || [],
            pagePaths: funnel.pagePaths || {}, homePage: funnel.homePage || '',
            domain: domain, domainVerified: funnel.domainVerified || false,
            ownerUid: ownerUid, status: status || 'draft',
            publishedAt: funnel.publishedAt || null,
          }, { merge: true })
        );

        if (domain && status === 'live') {
          const noWww   = domain.replace(/^www\./, '');
          const withWww = 'www.' + noWww;
          const record  = { domain, funnelId: doc.id, uid: ownerUid, repairedAt: new Date().toISOString() };
          writes.push(db.collection('domain-map').doc(domain).set(record, { merge: true }));
          writes.push(db.collection('domain-map').doc(noWww).set({ ...record, domain: noWww }, { merge: true }));
          writes.push(db.collection('domain-map').doc(withWww).set({ ...record, domain: withWww }, { merge: true }));
          repaired++;
        }
      });
      await Promise.all(writes);
      console.log('[sync-domain] repairAll — repaired', repaired, 'domain mappings across all users');
      return res.status(200).json({ ok: true, repaired, message: 'Repaired ' + repaired + ' domain mappings across all users' });
    } catch(e) {
      console.error('[sync-domain] repairAll error:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

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
