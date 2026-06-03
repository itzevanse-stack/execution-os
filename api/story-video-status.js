/**
 * GET /api/story-video-status?jobId=sv_xxx
 *
 * Reads the Firestore job document and returns its current status.
 * Also checks Runway task status for any pending scenes and advances
 * the job progress, so the job self-heals even without the webhook.
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
  const resp = await fetch(`${RUNWAY_API}/tasks/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${RUNWAY_KEY}`,
      'X-Runway-Version': '2024-11-06',
    },
  });
  if (!resp.ok) return null;
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  try {
    const docRef  = db.collection('story_video_jobs').doc(jobId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ status: 'failed', error: 'Job not found' });
    }

    const job = docSnap.data();

    // If already complete or failed, return as-is
    if (job.status === 'complete' || job.status === 'failed') {
      return res.status(200).json({
        status:        job.status,
        progress:      job.status === 'complete' ? 100 : job.progress,
        statusLabel:   job.status === 'complete' ? 'Complete!' : (job.error || 'Failed'),
        finalVideoUrl: job.finalVideoUrl || null,
        narration:     job.narration     || '',
        error:         job.error         || null,
      });
    }

    // Poll each pending Runway task to advance progress
    if (job.scenes && job.scenes.length > 0) {
      const scenes = [...job.scenes];
      let completedCount = scenes.filter(s => s.status === 'complete').length;
      let anyUpdated = false;

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        if (scene.status === 'complete') continue;
        if (!scene.runwayTaskId) continue;

        try {
          const task = await checkRunwayTask(scene.runwayTaskId);
          if (!task) continue;

          if (task.status === 'SUCCEEDED') {
            scenes[i] = {
              ...scene,
              status:   'complete',
              videoUrl: task.output?.[0] || null,
            };
            completedCount++;
            anyUpdated = true;
          } else if (task.status === 'FAILED') {
            scenes[i] = { ...scene, status: 'failed' };
            anyUpdated = true;
          }
        } catch (e) {
          // Non-fatal — just log and continue
          console.warn(`[story-video-status] Runway check failed for task ${scene.runwayTaskId}:`, e.message);
        }
      }

      const total   = scenes.length;
      const pct     = Math.round(10 + (completedCount / total) * 55); // 10-65% for scene rendering
      const allDone = completedCount === total;

      const updates = { scenes, progress: pct, updatedAt: FieldValue.serverTimestamp() };

      if (allDone) {
        // All scenes rendered — trigger stitching phase
        updates.status      = 'stitching';
        updates.progress    = 70;
        updates.statusLabel = 'All scenes rendered — stitching video…';
        anyUpdated = true;
      } else {
        updates.statusLabel = `Rendering scenes… (${completedCount}/${total} done)`;
      }

      if (anyUpdated) {
        await docRef.update(updates);
        Object.assign(job, updates);
      }

      // If now stitching, kick off the stitch in the background (non-blocking)
      if (job.status === 'stitching' || updates.status === 'stitching') {
        const completedScenes = scenes.filter(s => s.status === 'complete' && s.videoUrl);
        if (completedScenes.length > 0) {
          // Fire-and-forget stitch call (Cloudinary or FFmpeg)
          // The webhook or next poll will pick up the result
          kickoffStitch(jobId, job, completedScenes).catch(e =>
            console.error('[story-video-status] Stitch kickoff error:', e.message)
          );
        }
      }
    }

    // Re-read after potential updates
    const updated = (await docRef.get()).data();

    return res.status(200).json({
      status:      updated.status,
      progress:    updated.progress     || 10,
      statusLabel: updated.statusLabel  || 'Processing…',
      finalVideoUrl: updated.finalVideoUrl || null,
      narration:   updated.narration    || '',
      error:       updated.error        || null,
    });

  } catch (err) {
    console.error('[story-video-status] Error:', err);
    return res.status(500).json({ status: 'failed', error: err.message });
  }
}

// ── Stitch helper (fire-and-forget) ──────────────────────────────
async function kickoffStitch(jobId, job, completedScenes) {
  const CLOUDINARY_CLOUD  = process.env.CLOUDINARY_CLOUD_NAME || 'dkjrpsvxv';
  const CLOUDINARY_KEY    = process.env.CLOUDINARY_API_KEY;
  const CLOUDINARY_SECRET = process.env.CLOUDINARY_API_SECRET;

  const docRef = db.collection('story_video_jobs').doc(jobId);

  // Already stitching in progress guard
  const snap = await docRef.get();
  if (snap.data()?.stitchStarted) return;
  await docRef.update({ stitchStarted: true, updatedAt: FieldValue.serverTimestamp() });

  try {
    // Build a Cloudinary multi-video concatenation transformation
    // Each scene becomes a layer: fl_splice,l_video:PUBLIC_ID
    // We need to upload each scene URL first and get public IDs, then concat
    const uploadResults = await Promise.all(
      completedScenes.map(async (scene, i) => {
        const formData = new URLSearchParams();
        formData.append('file',   scene.videoUrl);
        formData.append('upload_preset', 'ml_default');
        formData.append('resource_type', 'video');
        formData.append('public_id', `story_${jobId}_scene_${i}`);

        const ts  = Math.floor(Date.now() / 1000);
        const str = `public_id=story_${jobId}_scene_${i}&timestamp=${ts}${CLOUDINARY_SECRET}`;
        const sig = await sha1(str);

        const fd = new FormData();
        fd.append('file',          scene.videoUrl);
        fd.append('timestamp',     ts.toString());
        fd.append('api_key',       CLOUDINARY_KEY);
        fd.append('signature',     sig);
        fd.append('public_id',     `story_${jobId}_scene_${i}`);
        fd.append('resource_type', 'video');

        const r = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
          { method: 'POST', body: fd }
        );
        const d = await r.json();
        if (!d.public_id) throw new Error('Cloudinary upload failed: ' + JSON.stringify(d));
        return d.public_id;
      })
    );

    // Build concat URL: base + splice each additional scene
    // Cloudinary multi_concat: use the first video + fl_splice for each subsequent
    const [base, ...rest] = uploadResults;
    let transformation = '';
    for (const pid of rest) {
      const encoded = pid.replace(/\//g, ':');
      transformation += `/fl_splice,l_video:${encoded}/fl_layer_apply`;
    }

    // Add narration audio via HeyGen if voiceMode is heygen
    // (advanced — omit here; narration audio handled separately via HeyGen avatar overlay)

    const finalUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload${transformation}/q_auto/${base}.mp4`;

    await docRef.update({
      status:        'complete',
      progress:      100,
      statusLabel:   'Complete!',
      finalVideoUrl: finalUrl,
      updatedAt:     FieldValue.serverTimestamp(),
    });

    console.log(`[story-video stitch] Job ${jobId} complete — ${finalUrl}`);

  } catch (err) {
    console.error(`[story-video stitch] Job ${jobId} stitch failed:`, err.message);
    await docRef.update({
      status:    'failed',
      error:     'Stitching failed: ' + err.message,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function sha1(str) {
  const crypto = await import('crypto');
  return crypto.createHash('sha1').update(str).digest('hex');
}
