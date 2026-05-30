// api/story-video-status.js — Poll job status and stitch when all scenes ready
// Called by the client every 5 seconds after /api/story-video returns a jobId
//
// GET  ?jobId=sv_xxx
// POST { jobId }
// Returns: { status, progress, finalVideoUrl, sceneUrls, error }

'use strict';

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');
const cloudinary                        = require('cloudinary').v2;

function getDb() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
    })});
  }
  return getFirestore();
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const RUNWAY_KEY  = process.env.RUNWAY_API_KEY;
const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';

// ── Check Runway task status ──────────────────────────────────────
async function checkRunwayTask(taskId) {
  const resp = await fetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
    headers: {
      'Authorization':  `Bearer ${RUNWAY_KEY}`,
      'X-Runway-Version': '2024-11-06',
    },
  });
  if (!resp.ok) return { status: 'PENDING' };
  const data = await resp.json();
  return {
    status:   data.status,        // PENDING | RUNNING | SUCCEEDED | FAILED
    videoUrl: data.output?.[0]    // URL when SUCCEEDED
              || data.artifacts?.[0]?.url
              || null,
    progress: data.progressRatio || 0,
  };
}

// ── Check HeyGen job status ───────────────────────────────────────
async function checkHeyGenJob(jobId) {
  const resp = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${jobId}`, {
    headers: { 'x-api-key': process.env.HEYGEN_API_KEY },
  });
  if (!resp.ok) return { status: 'pending' };
  const data = await resp.json();
  return {
    status:   data.data?.status   || 'pending',
    videoUrl: data.data?.video_url || null,
  };
}

// ── Upload URL to Cloudinary ──────────────────────────────────────
async function uploadToCloudinary(url, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(url, {
      resource_type: 'video',
      public_id:     publicId,
      folder:        'story-videos',
      overwrite:     true,
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result.secure_url);
    });
  });
}

// ── Stitch all clips into final video via Cloudinary ─────────────
async function stitchVideo(job, sceneUrls, voiceUrl) {
  const { scenes, charMode, musicMood, jobId } = job;

  // Build ordered list of clip URLs
  const orderedClips = scenes.map((scene, i) => {
    if (scene.isAvatarScene && charMode === 'avatar' && job.avatarUrls && job.avatarUrls[i]) {
      return job.avatarUrls[i];
    }
    return sceneUrls[i] || null;
  }).filter(Boolean);

  if (!orderedClips.length) throw new Error('No scene clips available for stitching');

  // Upload all clips to Cloudinary first (they need to be Cloudinary assets)
  const cloudinaryClips = [];
  for (let i = 0; i < orderedClips.length; i++) {
    const publicId = `story-videos/${jobId}/scene_${i}`;
    try {
      const cdnUrl = await uploadToCloudinary(orderedClips[i], publicId);
      cloudinaryClips.push(cdnUrl);
    } catch(e) {
      console.warn(`[stitch] Scene ${i} upload failed:`, e.message);
    }
  }

  if (!cloudinaryClips.length) throw new Error('No clips uploaded to Cloudinary');

  // Build the concatenation transformation
  // Cloudinary concatenates video using the fl_splice transformation
  const basePublicId = `story-videos/${jobId}/scene_0`;
  const spliceTransformations = [];

  // Add each subsequent clip as a splice
  for (let i = 1; i < cloudinaryClips.length; i++) {
    const clipPublicId = `story-videos/${jobId}/scene_${i}`;
    spliceTransformations.push({
      overlay: `video:${clipPublicId.replace(/\//g, ':')}`,
      flags:   'splice',
    });
    spliceTransformations.push({ flags: 'layer_apply' });
  }

  // Add voiceover if available
  if (voiceUrl) {
    try {
      const voicePublicId = `story-videos/${jobId}/voice`;
      await uploadToCloudinary(voiceUrl, voicePublicId);
      spliceTransformations.push({
        overlay: `video:${voicePublicId.replace(/\//g,':')}`,
        flags:   'layer_apply',
        audio_codec: 'aac',
      });
    } catch(e) {
      console.warn('[stitch] Voice overlay failed:', e.message);
    }
  }

  // Add background music
  const MUSIC_TRACKS = {
    'emotional-piano':       'story-music-piano',
    'epic-cinematic':        'story-music-epic',
    'inspirational-uplifting':'story-music-inspire',
    'raw-acoustic':          'story-music-acoustic',
  };
  // Note: In production, upload royalty-free music files to Cloudinary
  // with these public IDs. For now, skip music if tracks aren't available.

  // Generate the final stitched video URL
  const finalPublicId = `story-videos/${jobId}/final`;
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.explicit(basePublicId, {
      resource_type:   'video',
      type:            'upload',
      eager:           [{ transformation: spliceTransformations }],
      eager_async:     false,
      public_id_prefix: finalPublicId,
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  return result?.eager?.[0]?.secure_url
    || result?.secure_url
    || cloudinaryClips[0]; // fallback to first clip if stitching fails
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const jobId = req.query.jobId || (req.body && req.body.jobId);
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const db = getDb();
  const jobRef  = db.collection('storyJobs').doc(jobId);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) return res.status(404).json({ error: 'Job not found' });
  const job = jobSnap.data();

  // If already complete or failed, return immediately
  if (job.status === 'complete') {
    return res.status(200).json({
      ok:            true,
      status:        'complete',
      progress:      100,
      finalVideoUrl: job.finalVideoUrl,
      narration:     job.fullNarration,
      hook:          job.hook,
    });
  }
  if (job.status === 'failed') {
    return res.status(200).json({ ok: false, status: 'failed', error: job.error || 'Generation failed' });
  }

  // ── Check Runway scene progress ───────────────────────────────
  const runwayTaskIds = job.runwayTaskIds || [];
  const sceneUrls     = { ...(job.sceneUrls || {}) };
  let   allScenesReady= true;
  let   completedCount= 0;

  for (let i = 0; i < runwayTaskIds.length; i++) {
    const taskId = runwayTaskIds[i];
    if (!taskId) {
      // Avatar scene — skip Runway check
      completedCount++;
      continue;
    }
    if (sceneUrls[i]) {
      completedCount++;
      continue;
    }
    try {
      const result = await checkRunwayTask(taskId);
      if (result.status === 'SUCCEEDED' && result.videoUrl) {
        sceneUrls[i] = result.videoUrl;
        completedCount++;
      } else if (result.status === 'FAILED') {
        console.warn(`[status] Scene ${i} failed`);
        completedCount++; // count it so we don't block forever
      } else {
        allScenesReady = false;
      }
    } catch(e) {
      allScenesReady = false;
    }
  }

  // ── Check HeyGen voiceover ────────────────────────────────────
  let voiceUrl  = job.voiceUrl;
  let voiceReady= !!voiceUrl;
  if (!voiceReady && job.voiceJobId) {
    try {
      const vStatus = await checkHeyGenJob(job.voiceJobId);
      if (vStatus.status === 'completed' && vStatus.videoUrl) {
        voiceUrl   = vStatus.videoUrl;
        voiceReady = true;
      }
    } catch(e) {}
  }
  if (!job.voiceJobId) voiceReady = true; // No voice job — skip

  // ── Check HeyGen avatar segments ──────────────────────────────
  const avatarJobIds = job.avatarJobIds || {};
  const avatarUrls   = { ...(job.avatarUrls || {}) };
  let   avatarsReady = true;

  for (const [sceneIdx, avatarJobId] of Object.entries(avatarJobIds)) {
    if (avatarUrls[sceneIdx]) continue;
    try {
      const aStatus = await checkHeyGenJob(avatarJobId);
      if (aStatus.status === 'completed' && aStatus.videoUrl) {
        avatarUrls[sceneIdx] = aStatus.videoUrl;
      } else if (aStatus.status !== 'failed') {
        avatarsReady = false;
      }
    } catch(e) {
      avatarsReady = false;
    }
  }

  // Calculate progress
  const totalScenes = runwayTaskIds.length || 1;
  let   progress    = Math.round((completedCount / totalScenes) * 70); // scenes = 70%
  if (voiceReady)  progress = Math.min(progress + 15, 85);  // voice = +15%
  if (avatarsReady)progress = Math.min(progress + 10, 95);  // avatars = +10%

  // Update Firestore with latest URLs
  const updates = {
    sceneUrls,
    avatarUrls,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (voiceUrl)  updates.voiceUrl  = voiceUrl;
  await jobRef.update(updates);

  // ── All ready — stitch final video ───────────────────────────
  if (allScenesReady && voiceReady && avatarsReady) {
    try {
      await jobRef.update({ status: 'stitching' });

      const jobWithAvatars = { ...job, avatarUrls, sceneUrls };
      const finalVideoUrl  = await stitchVideo(jobWithAvatars, sceneUrls, voiceUrl);

      await jobRef.update({
        status:        'complete',
        finalVideoUrl,
        completedAt:   FieldValue.serverTimestamp(),
      });

      // Save to user's video library in Firestore
      if (job.uid) {
        const db2 = getDb();
        await db2.collection('users').doc(job.uid).collection('videos').add({
          type:         'story',
          title:        job.hook || 'Story Video',
          videoUrl:     finalVideoUrl,
          framework:    job.framework,
          style:        job.style,
          narration:    job.fullNarration,
          createdAt:    FieldValue.serverTimestamp(),
        });
      }

      return res.status(200).json({
        ok:            true,
        status:        'complete',
        progress:      100,
        finalVideoUrl,
        narration:     job.fullNarration,
        hook:          job.hook,
      });
    } catch(stitchErr) {
      await jobRef.update({ status: 'failed', error: stitchErr.message });
      return res.status(200).json({ ok: false, status: 'failed', error: stitchErr.message });
    }
  }

  // Still processing
  const statusLabel = !allScenesReady
    ? `Generating scenes… (${completedCount}/${totalScenes} ready)`
    : !voiceReady   ? 'Creating voiceover…'
    : !avatarsReady ? 'Rendering avatar segments…'
    : 'Preparing to stitch…';

  return res.status(200).json({
    ok:         true,
    status:     'processing',
    progress,
    statusLabel,
    scenesDone: completedCount,
    scenesTotal:totalScenes,
  });
};
