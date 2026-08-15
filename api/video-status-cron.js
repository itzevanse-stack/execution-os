// api/video-status-cron.js
// Checks on HeyGen reel videos submitted by Automate that are still marked
// 'rendering', and updates the calendar entry once HeyGen reports completion.
//
// Why this exists: automate.js submits reel scripts to HeyGen and gets back
// a job ID, but nothing ever checked back afterward — reels would sit stuck
// at "rendering" in the calendar forever, even after the video actually
// finished on HeyGen's servers. This cron closes that loop.
//
// Runs every 5 minutes (see vercel.json) — HeyGen renders typically finish
// in 5-15 minutes, so this keeps the calendar reasonably close to real-time
// without excessive polling.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';

// ── Firebase init — same pattern as sequence-cron.js ──────────────────────
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

// ── HeyGen status check — direct server-to-server call, same endpoint
// api/heygen.js uses for its own 'status' action ─────────────────────────
async function checkHeyGenStatus(videoId) {
  const KEY = process.env.HEYGEN_API_KEY;
  if (!KEY || !videoId) return null;
  try {
    const resp = await fetch(`https://api.heygen.com/v2/videos/${encodeURIComponent(videoId)}`, {
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' },
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return null; }
    if (!resp.ok || !data?.data) return null;
    const info = data.data;
    return {
      status:   info.status || 'processing', // pending | processing | completed | failed
      videoUrl: info.video_url || null,
      error:    info.error || null,
    };
  } catch(e) {
    console.warn('[video-status-cron] HeyGen check failed for', videoId, ':', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Security: same cron-secret pattern as sequence-cron.js ────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const queryParam = req.query?.secret || '';
    const provided   = authHeader.replace('Bearer ', '') || queryParam;
    if (provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const results = { checked: 0, completed: 0, failed: 0, stillRendering: 0, errors: 0 };

  try {
    // ── Find rendering reels across ALL users' calendar days ────────────────
    // Firestore can't OR-query two different field paths (reel1.status and
    // reel2.status) in one call, so we run two collectionGroup queries.
    // NOTE: the first time this runs, Firestore may return an error with a
    // direct link to create the required composite index — that's normal,
    // just click the link once and it'll work from then on.
    const [reel1Snap, reel2Snap] = await Promise.all([
      db.collectionGroup('days').where('reel1.status', '==', 'rendering').limit(25).get(),
      db.collectionGroup('days').where('reel2.status', '==', 'rendering').limit(25).get(),
    ]);

    const jobs = [];
    reel1Snap.docs.forEach(doc => jobs.push({ doc, field: 'reel1' }));
    reel2Snap.docs.forEach(doc => jobs.push({ doc, field: 'reel2' }));

    if (!jobs.length) {
      console.log('[video-status-cron] No reels currently rendering');
      return res.status(200).json({ message: 'No pending reels', ...results });
    }

    results.checked = jobs.length;
    console.log(`[video-status-cron] Checking ${jobs.length} rendering reel(s)`);

    for (const { doc, field } of jobs) {
      try {
        const data  = doc.data();
        const piece = data[field];
        if (!piece || piece.status !== 'rendering' || !piece.heygenJobId) {
          continue; // already updated by a previous run, or malformed — skip safely
        }

        const heygenResult = await checkHeyGenStatus(piece.heygenJobId);
        if (!heygenResult) {
          results.errors++;
          continue; // transient HeyGen/network issue — will retry next run
        }

        if (heygenResult.status === 'completed' && heygenResult.videoUrl) {
          await doc.ref.update({
            [`${field}.status`]:   'ready',
            [`${field}.videoUrl`]: heygenResult.videoUrl,
            [`${field}.readyAt`]:  FieldValue.serverTimestamp(),
          });
          results.completed++;
          console.log(`[video-status-cron] ✅ ${field} on ${doc.ref.path} is ready`);

        } else if (heygenResult.status === 'failed') {
          await doc.ref.update({
            [`${field}.status`]: 'failed',
            [`${field}.error`]:  heygenResult.error || 'HeyGen render failed',
          });
          results.failed++;
          console.warn(`[video-status-cron] ❌ ${field} on ${doc.ref.path} failed`);

        } else {
          results.stillRendering++;
          // still processing — leave as-is, will check again next run
        }
      } catch(itemErr) {
        console.error('[video-status-cron] Error processing', doc.ref.path, ':', itemErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({
      message: `Checked ${results.checked} rendering reel(s)`,
      ...results,
      timestamp: new Date().toISOString(),
    });

  } catch(err) {
    console.error('[video-status-cron] Fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
