/**
 * GET /api/story-video-status?jobId=sv_xxx
 *
 * Reads the Firestore job document, checks Runway task status for
 * pending scenes, advances progress, and triggers the dedicated
 * stitch endpoint once all scenes are complete.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

const RUNWAY_API = 'https://api.dev.runwayml.com/v1';
const RUNWAY_KEY = process.env.RUNWAY_API_KEY;

async function checkRunwayTask(taskId) {
  try {
    const resp = await fetch(`${RUNWAY_API}/tasks/${taskId}`, {
      headers: {
        'Authorization':    `Bearer ${RUNWAY_KEY}`,
        'X-Runway-Version': '2024-11-06',
      },
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  try {
    const docRef  = db.collection('story_video_jobs').doc(jobId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ status: 'failed', error: 'Job not found' });
    }

    const job = docSnap.data();

    // Already finished — return immediately
    if (job.status === 'complete' || job.status === 'failed') {
      return res.status(200).json({
        status:        job.status,
        progress:      job.status === 'complete' ? 100 : job.progress || 0,
        statusLabel:   job.status === 'complete' ? 'Complete!' : (job.error || 'Failed'),
        finalVideoUrl: job.finalVideoUrl || null,
        narration:     job.narration     || '',
        error:         job.error         || null,
      });
    }

    // Stitching in progress — just report current state, stitch runs in its own function
    if (job.status === 'stitching') {
      return res.status(200).json({
        status:      'stitching',
        progress:    job.progress    || 70,
        statusLabel: job.statusLabel || 'Stitching scenes, audio and music…',
        narration:   job.narration   || '',
      });
    }

    // Processing — check Runway task status for each pending scene
    const scenes       = JSON.parse(JSON.stringify(job.scenes || []));
    let completedCount = scenes.filter(s => s.status === 'complete').length;
    let anyUpdated     = false;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (scene.status === 'complete' || !scene.runwayTaskId) continue;

      const task = await checkRunwayTask(scene.runwayTaskId);
      if (!task) continue;

      if (task.status === 'SUCCEEDED') {
        scenes[i] = { ...scene, status: 'complete', videoUrl: task.output?.[0] || null };
        completedCount++;
        anyUpdated = true;
      } else if (task.status === 'FAILED') {
        scenes[i] = { ...scene, status: 'failed' };
        anyUpdated = true;
      }
    }

    const total   = scenes.length || 1;
    const pct     = Math.round(10 + (completedCount / total) * 55); // 10–65%
    const allDone = completedCount === total;

    if (anyUpdated) {
      await docRef.update({
        scenes,
        progress:    allDone ? 68 : pct,
        statusLabel: allDone
          ? 'All scenes ready — starting stitch…'
          : `Rendering scenes… (${completedCount}/${total} done)`,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // All scenes complete — trigger the dedicated stitch function
    if (allDone && !job.stitchStarted) {
      const stitchUrl = (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://build.skillslibrary.com') + '/api/story-video-stitch';

      fetch(stitchUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId }),
      }).catch(e => console.warn('[status] Stitch trigger failed:', e.message));
    }

    return res.status(200).json({
      status:      allDone ? 'stitching' : 'processing',
      progress:    allDone ? 68 : pct,
      statusLabel: allDone
        ? 'All scenes ready — starting stitch…'
        : `Rendering scenes… (${completedCount}/${total} done)`,
      narration:   job.narration || '',
    });

  } catch (err) {
    console.error('[story-video-status] Error:', err);
    return res.status(500).json({ status: 'failed', error: err.message });
  }
}
