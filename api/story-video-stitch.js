/**
 * POST /api/story-video-stitch
 *
 * Takes completed Runway scene URLs and builds the final video.
 * Strategy: use Cloudinary's remote fetch + video concatenation
 * so we never need to upload files — Cloudinary fetches them directly.
 * Falls back to returning the first scene URL if Cloudinary fails.
 *
 * maxDuration: 300 (vercel.json)
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

const CLOUD  = process.env.CLOUDINARY_CLOUD_NAME || 'dkjrpsvxv';
const KEY    = process.env.CLOUDINARY_API_KEY;
const SECRET = process.env.CLOUDINARY_API_SECRET;

// Upload a video from a remote URL to Cloudinary using fetch
async function cloudinaryFetchUpload(remoteUrl, publicId) {
  const ts  = Math.floor(Date.now() / 1000);
  const str = `public_id=${publicId}&timestamp=${ts}&type=fetch${SECRET}`;
  const sig = crypto.createHash('sha1').update(str).digest('hex');

  const form = new URLSearchParams();
  form.append('file',          remoteUrl);
  form.append('public_id',     publicId);
  form.append('type',          'fetch');
  form.append('resource_type', 'video');
  form.append('timestamp',     String(ts));
  form.append('api_key',       KEY);
  form.append('signature',     sig);

  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/video/upload`, {
    method: 'POST',
    body:   form,
    signal: AbortSignal.timeout(90000), // 90s per upload
  });

  const d = await r.json();
  if (!d.public_id) throw new Error('Upload failed: ' + JSON.stringify(d).slice(0, 200));
  return d.public_id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const docRef = db.collection('story_video_jobs').doc(jobId);
  const snap   = await docRef.get();

  if (!snap.exists) return res.status(404).json({ error: 'Job not found' });

  const job = snap.data();

  // Guard: only run once
  if (job.stitchStarted) {
    return res.status(200).json({ ok: true, message: 'Already running' });
  }
  if (job.status === 'complete' || job.status === 'failed') {
    return res.status(200).json({ ok: true, message: 'Already finished' });
  }

  // Mark started immediately so concurrent polls don't double-trigger
  await docRef.update({
    stitchStarted: true,
    status:        'stitching',
    progress:      72,
    statusLabel:   'Building final video…',
    updatedAt:     FieldValue.serverTimestamp(),
  });

  // Respond immediately — do heavy work after
  res.status(200).json({ ok: true, jobId });

  const completedScenes = (job.scenes || []).filter(s => s.status === 'complete' && s.videoUrl);

  if (completedScenes.length === 0) {
    await docRef.update({
      status: 'failed', error: 'No completed scenes to stitch',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  try {
    await docRef.update({ progress: 75, statusLabel: 'Uploading scenes…', updatedAt: FieldValue.serverTimestamp() });

    // Upload all scenes to Cloudinary concurrently (fetch from Runway URLs)
    const publicIds = await Promise.all(
      completedScenes.map((scene, i) =>
        cloudinaryFetchUpload(scene.videoUrl, `sv_${jobId}_scene_${i}`)
      )
    );

    await docRef.update({ progress: 88, statusLabel: 'Concatenating scenes…', updatedAt: FieldValue.serverTimestamp() });

    // Build Cloudinary video concatenation URL
    // Uses fl_splice to join scenes: base/fl_splice,l_video:scene1/fl_layer_apply/...
    const [base, ...rest] = publicIds;
    let transformation = '';
    for (const pid of rest) {
      const safe = pid.replace(/\//g, ':'); // Cloudinary uses : not / in layer names
      transformation += `/fl_splice,l_video:${safe}/fl_layer_apply`;
    }

    const finalUrl = `https://res.cloudinary.com/${CLOUD}/video/upload${transformation}/q_auto:good,vc_auto/${base}.mp4`;

    await docRef.update({
      status:        'complete',
      progress:      100,
      statusLabel:   'Complete!',
      finalVideoUrl: finalUrl,
      sceneUrls:     completedScenes.map(s => s.videoUrl), // keep individual scene URLs too
      updatedAt:     FieldValue.serverTimestamp(),
    });

    console.log(`[stitch] ${jobId} complete — ${finalUrl}`);

  } catch (err) {
    console.error(`[stitch] ${jobId} failed:`, err.message);

    // FALLBACK: if Cloudinary fails, return the first scene URL so user gets something
    const fallbackUrl = completedScenes[0]?.videoUrl || null;

    await docRef.update({
      status:        fallbackUrl ? 'complete' : 'failed',
      progress:      fallbackUrl ? 100 : 0,
      statusLabel:   fallbackUrl ? 'Complete (scene 1 only — full stitch failed)' : 'Stitch failed',
      finalVideoUrl: fallbackUrl,
      sceneUrls:     completedScenes.map(s => s.videoUrl),
      error:         'Stitch error: ' + err.message + (fallbackUrl ? ' — showing scene 1 as fallback' : ''),
      updatedAt:     FieldValue.serverTimestamp(),
    });
  }
}
