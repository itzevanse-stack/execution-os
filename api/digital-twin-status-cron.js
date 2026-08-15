// api/digital-twin-status-cron.js
// Checks on Digital Twin (video avatar) trainings still marked 'in_progress'
// and updates Firestore once HeyGen reports completion or failure.
//
// Why this exists: avsSubmitVideo/avsSubmitRecording submit a Digital Twin
// creation request and save { digitalTwinStatus: 'in_progress' } to the
// user's Firestore doc — but training takes 2-4 hours, and nothing else
// ever checks back. This closes that loop, same pattern as
// video-status-cron.js for reels, but on a much longer interval since
// Digital Twin training is hours, not minutes.
//
// Runs every 30 minutes (see vercel.json).

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';

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

// ── HeyGen Digital Twin status check — real endpoint, confirmed against
// docs.heygen.com/reference/check-video-avatar-generation-status ──────────
async function checkDigitalTwinStatus(avatarId) {
  const KEY = process.env.HEYGEN_API_KEY;
  if (!KEY || !avatarId) return null;
  try {
    const resp = await fetch(`https://api.heygen.com/v2/video_avatar/${encodeURIComponent(avatarId)}`, {
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' },
    });
    if (resp.status === 404) {
      return { status: 'failed', error: 'Digital Twin ID not found on HeyGen — it may have been deleted.' };
    }
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return null; }
    if (!resp.ok) return null;
    const info = data?.data || {};
    return {
      status: info.status || 'in_progress', // in_progress | complete | failed
      error:  info.error || info.failure_reason || null,
    };
  } catch(e) {
    console.warn('[digital-twin-cron] HeyGen check failed for', avatarId, ':', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const queryParam = req.query?.secret || '';
    const provided   = authHeader.replace('Bearer ', '') || queryParam;
    if (provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const results = { checked: 0, completed: 0, failed: 0, stillTraining: 0, errors: 0 };

  try {
    const snap = await db.collection('users')
      .where('digitalTwinStatus', '==', 'in_progress')
      .limit(25)
      .get();

    if (snap.empty) {
      console.log('[digital-twin-cron] No Digital Twins currently training');
      return res.status(200).json({ message: 'No pending Digital Twins', ...results });
    }

    results.checked = snap.size;
    console.log(`[digital-twin-cron] Checking ${snap.size} Digital Twin(s) in progress`);

    for (const doc of snap.docs) {
      try {
        const data = doc.data();
        const avatarId = data.digitalTwinAvatarId;
        if (!avatarId) continue;

        const heygenResult = await checkDigitalTwinStatus(avatarId);
        if (!heygenResult) {
          results.errors++;
          continue; // transient issue — retry next run
        }

        if (heygenResult.status === 'complete') {
          await doc.ref.set({
            digitalTwinStatus: 'complete',
            digitalTwinReadyAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          results.completed++;
          console.log(`[digital-twin-cron] ✅ Digital Twin ready for user ${doc.id}`);

        } else if (heygenResult.status === 'failed') {
          await doc.ref.set({
            digitalTwinStatus: 'failed',
            digitalTwinError:  heygenResult.error || 'Digital Twin training failed',
          }, { merge: true });
          results.failed++;
          console.warn(`[digital-twin-cron] ❌ Digital Twin failed for user ${doc.id}`);

        } else {
          results.stillTraining++;
        }
      } catch(itemErr) {
        console.error('[digital-twin-cron] Error processing', doc.id, ':', itemErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({
      message: `Checked ${results.checked} Digital Twin(s)`,
      ...results,
      timestamp: new Date().toISOString(),
    });

  } catch(err) {
    console.error('[digital-twin-cron] Fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
