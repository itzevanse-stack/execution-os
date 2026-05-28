/**
 * api/diagnose.js
 * 
 * Temporary diagnostic endpoint.
 * Visit: https://execution-os-xi.vercel.app/api/diagnose?domain=rawaddigital.com
 * 
 * Shows exactly what is in Firestore for that domain.
 * DELETE THIS FILE after the issue is resolved.
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

  const domain = (req.query.domain || '').toLowerCase().replace(/^www\./, '').trim();
  if (!domain) return res.status(400).json({ error: 'Pass ?domain=yourdomain.com' });

  const report = {
    domain,
    timestamp: new Date().toISOString(),
    env: {
      FIREBASE_PROJECT_ID:   !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY:  !!process.env.FIREBASE_PRIVATE_KEY,
    },
    firebaseInit: false,
    domainMap: null,
    publishedFunnelsQuery: null,
    publishedFunnelsDirect: null,
    error: null,
  };

  try {
    const db = initFirebase();
    report.firebaseInit = true;

    // Check 1: domain-map
    try {
      const snap = await db.collection('domain-map').doc(domain).get();
      report.domainMap = snap.exists
        ? { exists: true, data: snap.data() }
        : { exists: false };
    } catch(e) {
      report.domainMap = { error: e.message };
    }

    // Check 2: published-funnels query by domain
    try {
      const q = await db.collection('published-funnels')
        .where('domain', '==', domain).limit(3).get();
      report.publishedFunnelsQuery = {
        count: q.size,
        docs: q.docs.map(d => ({
          id:     d.id,
          domain: d.data().domain,
          status: d.data().status,
          hasPages: !!(d.data().pages && Object.keys(d.data().pages).length > 0),
          ownerUid: d.data().ownerUid,
        }))
      };
    } catch(e) {
      report.publishedFunnelsQuery = { error: e.message };
    }

    // Check 3: all published-funnels — show domain field for each
    try {
      const all = await db.collection('published-funnels')
        .where('status', '==', 'live').get();
      report.allLiveFunnels = all.docs.map(d => ({
        id:     d.id,
        domain: d.data().domain || '(empty)',
        status: d.data().status,
        ownerUid: d.data().ownerUid,
      }));
    } catch(e) {
      report.allLiveFunnels = { error: e.message };
    }

  } catch(e) {
    report.error = e.message;
    report.firebaseInit = false;
  }

  return res.status(200).json(report, null, 2);
};
