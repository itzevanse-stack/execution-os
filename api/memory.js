import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Safe Firebase init ────────────────────────────────────────────────────────
function getDB() {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase env vars missing: check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in Vercel');
  }

  const app = getApps().length ? getApp() : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore(app);
}

function sendError(res, message, status = 500) {
  console.error('[api/memory]', message);
  return res.status(status).json({ ok: false, error: message });
}

export default async function handler(req, res) {
  // Always JSON — never let Vercel serve an HTML error page for this route
  res.setHeader('Content-Type', 'application/json');

  // ── GET: load user memory ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return sendError(res, 'userId required', 400);

    let db;
    try { db = getDB(); } catch (err) { return sendError(res, err.message); }

    try {
      const doc = await db.collection('eos_users').doc(userId).get();
      return res.status(200).json({ ok: true, data: doc.exists ? doc.data() : null });
    } catch (err) {
      return sendError(res, err.message);
    }
  }

  // ── POST: save / update ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { userId, action, data } = req.body || {};
    if (!userId) return sendError(res, 'userId required', 400);

    let db;
    try { db = getDB(); } catch (err) { return sendError(res, 'Firebase init failed: ' + err.message); }

    const ref = db.collection('eos_users').doc(userId);

    try {
      // Save plan after Boardroom generates
      if (action === 'save_plan') {
        await ref.set({
          userId,
          lastUpdated: FieldValue.serverTimestamp(),
          planVersion: FieldValue.increment(1),
          currentPlan: data?.plan       || null,
          avatarData:  data?.avatarData || null,
          offerData:   data?.offerData  || null,
        }, { merge: true });

        // Non-blocking history write
        ref.collection('plan_history').add({
          plan:    data?.plan || null,
          savedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});

        return res.status(200).json({ ok: true });
      }

      // Weekly check-in snapshot
      if (action === 'weekly_checkin') {
        const snap = {
          timestamp:     FieldValue.serverTimestamp(),
          salesMade:     data?.salesMade     || 0,
          conversations: data?.conversations || 0,
          contentPosts:  data?.contentPosts  || 0,
          revenue:       data?.revenue       || 0,
          planAdherence: data?.planAdherence || 0,
          biggestWin:    data?.biggestWin    || '',
          biggestBlock:  data?.biggestBlock  || '',
        };
        await Promise.all([
          ref.collection('weekly_checkins').add(snap),
          ref.set({
            lastUpdated:  FieldValue.serverTimestamp(),
            currentWeek:  FieldValue.increment(1),
            totalRevenue: FieldValue.increment(data?.revenue   || 0),
            totalSales:   FieldValue.increment(data?.salesMade || 0),
            ...(data?.newMilestone ? { milestones: FieldValue.arrayUnion(data.newMilestone) } : {}),
          }, { merge: true }),
        ]);
        const updated = await ref.get();
        return res.status(200).json({ ok: true, data: updated.data() });
      }

      // Log plan adaptation
      if (action === 'log_adaptation') {
        await ref.set({
          lastUpdated: FieldValue.serverTimestamp(),
          ...(data?.newPlan ? { currentPlan: data.newPlan } : {}),
          adaptations: FieldValue.arrayUnion(`Week ${data?.week || '?'}: ${data?.reason || 'Plan adapted'}`),
        }, { merge: true });
        return res.status(200).json({ ok: true });
      }

      // Get check-in history
      if (action === 'get_history') {
        const snap = await ref.collection('weekly_checkins')
          .orderBy('timestamp', 'desc').limit(12).get();
        return res.status(200).json({
          ok: true,
          history: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        });
      }

      return sendError(res, 'Unknown action: ' + action, 400);

    } catch (err) {
      return sendError(res, err.message);
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
