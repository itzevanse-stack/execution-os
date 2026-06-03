/**
 * POST /api/story-video-stitch
 * Called once by story-video-status when all Runway scenes are complete.
 * Uploads scenes to Cloudinary and builds the concatenated final video URL.
 * maxDuration: 300 (see vercel.json)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import crypto                            from 'crypto';

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

const CLOUDINARY_CLOUD  = process.env.CLOUDINARY_CLOUD_NAME || 'dkjrpsvxv';
const CLOUDINARY_KEY    = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_SECRET = process.env.CLOUDINARY_API_SECRET;

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

async function uploadToCloudinary(sceneVideoUrl, publicId) {
  const ts  = Math.floor(Date.now() / 1000);
  const sig = sha1(`public_id=${publicId}&timestamp=${ts}${CLOUDINARY_SECRET}`);

  const fd = new FormData();
  fd.append('file',          sceneVideoUrl);
  fd.append('timestamp',     ts.toString());
  fd.append('api_key',       CLOUDINARY_KEY);
  fd.append('signature',     sig);
  fd.append('public_id',     publicId);
  fd.append('resource_type', 'video');

  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
    { method: 'POST', body: fd }
  );
  const d = await r.json();
  if (!d.public_id) throw new Error('Cloudinary upload failed: ' + JSON.stringify(d).slice(0, 200));
  return d.public_id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const docRef = db.collection('story_video_jobs').doc(jobId);

  // Guard: only run once
  const snap = await docRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'Job not found' });
  const job = snap.data();

  if (job.stitchStarted) {
    return res.status(200).json({ ok: true, message: 'Stitch already in progress' });
  }
  if (job.status === 'complete' || job.status === 'failed') {
    return res.status(200).json({ ok: true, message: 'Job already finished' });
  }

  await docRef.update({
    stitchStarted: true,
    status:        'stitching',
    progress:      70,
    statusLabel:   'Uploading scenes and building final video…',
    updatedAt:     FieldValue.serverTimestamp(),
  });

  // Respond immediately so Vercel doesn't timeout the HTTP response
  // The actual work continues after res.end()
  res.status(200).json({ ok: true, jobId });

  // ── Do the heavy work after responding ──────────────────────────
  try {
    const completedScenes = (job.scenes || []).filter(s => s.status === 'complete' && s.videoUrl);

    if (completedScenes.length === 0) {
      throw new Error('No completed scenes to stitch');
    }

    await docRef.update({ progress: 75, statusLabel: 'Uploading scenes to Cloudinary…', updatedAt: FieldValue.serverTimestamp() });

    // Upload all scenes to Cloudinary concurrently
    const publicIds = await Promise.all(
      completedScenes.map((scene, i) =>
        uploadToCloudinary(scene.videoUrl, `story_${jobId}_scene_${i}`)
      )
    );

    await docRef.update({ progress: 90, statusLabel: 'Building final video…', updatedAt: FieldValue.serverTimestamp() });

    // Build Cloudinary concat transformation
    const [base, ...rest] = publicIds;
    let transformation = '';
    for (const pid of rest) {
      const encoded = pid.replace(/\//g, ':');
      transformation += `/fl_splice,l_video:${encoded}/fl_layer_apply`;
    }

    const finalUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload${transformation}/q_auto/${base}.mp4`;

    await docRef.update({
      status:        'complete',
      progress:      100,
      statusLabel:   'Complete!',
      finalVideoUrl: finalUrl,
      updatedAt:     FieldValue.serverTimestamp(),
    });

    console.log(`[stitch] Job ${jobId} complete — ${finalUrl}`);

  } catch (err) {
    console.error(`[stitch] Job ${jobId} failed:`, err.message);
    await docRef.update({
      status:    'failed',
      error:     'Stitching failed: ' + err.message,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}
