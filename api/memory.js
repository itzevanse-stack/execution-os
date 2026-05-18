// ── memory.js — EOS user memory via Firebase Firestore ───────────────────────
// Falls back gracefully if firebase-admin is not installed yet.

function getDB() {
  // This will throw if firebase-admin is not in package.json — caught below
  var admin = require('firebase-admin');

  var projectId   = process.env.FIREBASE_PROJECT_ID;
  var clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  var privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase env vars missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId: projectId, clientEmail: clientEmail, privateKey: privateKey })
    });
  }

  return admin.firestore();
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    var userId = req.query && req.query.userId;
    if (!userId) return json(res, 400, { ok: false, error: 'userId required' });

    var db;
    try {
      db = getDB();
    } catch (err) {
      console.error('[api/memory] Firebase unavailable:', err.message);
      // Return null data instead of erroring — app degrades gracefully
      return json(res, 200, { ok: true, data: null, _warning: err.message });
    }

    try {
      var doc = await db.collection('eos_users').doc(userId).get();
      return json(res, 200, { ok: true, data: doc.exists ? doc.data() : null });
    } catch (err) {
      console.error('[api/memory GET]', err.message);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    var body   = req.body || {};
    var userId = body.userId;
    var action = body.action;
    var data   = body.data || {};

    if (!userId) return json(res, 400, { ok: false, error: 'userId required' });

    var db;
    try {
      db = getDB();
    } catch (err) {
      console.error('[api/memory] Firebase unavailable:', err.message);
      // Acknowledge silently — data won't persist but app won't crash
      return json(res, 200, { ok: true, _warning: 'Firebase unavailable: ' + err.message });
    }

    var admin = require('firebase-admin');
    var FieldValue = admin.firestore.FieldValue;
    var ref = db.collection('eos_users').doc(userId);

    try {
      if (action === 'save_plan') {
        await ref.set({
          userId:      userId,
          lastUpdated: FieldValue.serverTimestamp(),
          planVersion: FieldValue.increment(1),
          currentPlan: data.plan       || null,
          avatarData:  data.avatarData || null,
          offerData:   data.offerData  || null,
        }, { merge: true });

        ref.collection('plan_history').add({
          plan:    data.plan || null,
          savedAt: FieldValue.serverTimestamp(),
        }).catch(function(){});

        return json(res, 200, { ok: true });
      }

      if (action === 'weekly_checkin') {
        var snap = {
          timestamp:     FieldValue.serverTimestamp(),
          salesMade:     data.salesMade     || 0,
          conversations: data.conversations || 0,
          contentPosts:  data.contentPosts  || 0,
          revenue:       data.revenue       || 0,
          planAdherence: data.planAdherence || 0,
          biggestWin:    data.biggestWin    || '',
          biggestBlock:  data.biggestBlock  || '',
        };
        await Promise.all([
          ref.collection('weekly_checkins').add(snap),
          ref.set({
            lastUpdated:  FieldValue.serverTimestamp(),
            currentWeek:  FieldValue.increment(1),
            totalRevenue: FieldValue.increment(data.revenue   || 0),
            totalSales:   FieldValue.increment(data.salesMade || 0),
          }, { merge: true }),
        ]);
        var updated = await ref.get();
        return json(res, 200, { ok: true, data: updated.data() });
      }

      if (action === 'log_adaptation') {
        await ref.set({
          lastUpdated: FieldValue.serverTimestamp(),
          adaptations: FieldValue.arrayUnion('Week ' + (data.week||'?') + ': ' + (data.reason||'Plan adapted')),
        }, { merge: true });
        return json(res, 200, { ok: true });
      }

      if (action === 'get_history') {
        var snaps = await ref.collection('weekly_checkins').orderBy('timestamp','desc').limit(12).get();
        return json(res, 200, {
          ok: true,
          history: snaps.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); })
        });
      }

      return json(res, 400, { ok: false, error: 'Unknown action: ' + action });

    } catch (err) {
      console.error('[api/memory POST]', err.message);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  return json(res, 405, { ok: false, error: 'Method not allowed' });
};
