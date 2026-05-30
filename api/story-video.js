// api/story-video.js — Cinematic Story Video Generator
// Orchestrates: Claude (script) → Runway ML (scenes) → HeyGen (voiceover + avatar) → Cloudinary (stitch)
//
// POST body: { uid, framework, start, turn, end, style, charMode, avatarId, voiceId, voiceMode }
// Returns:   { ok, taskId, scenes, scriptText, voiceJobId }
//   (client polls /api/story-video-status for completion)

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// ── Runway ML API ─────────────────────────────────────────────────
const RUNWAY_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';

async function runwayGenerateScene(prompt, duration) {
  const resp = await fetch(`${RUNWAY_BASE}/image_to_video`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RUNWAY_KEY}`,
      'Content-Type':  'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify({
      model:         'gen3a_turbo',
      promptText:    prompt,
      duration:      duration || 5,
      ratio:         '720:1280', // 9:16 portrait for social
      watermark:     false,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Runway API ${resp.status}: ${err.slice(0,200)}`);
  }
  const data = await resp.json();
  return data.id; // task ID — poll for completion
}

// ── HeyGen voiceover ──────────────────────────────────────────────
async function heygenVoiceover(script, voiceId) {
  const resp = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: {
      'x-api-key':    process.env.HEYGEN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: 'text', input_text: script },
        voice:     { type: 'voice_id', voice_id: voiceId },
      }],
      test:         false,
      aspect_ratio: '9:16',
    }),
  });
  if (!resp.ok) throw new Error(`HeyGen ${resp.status}`);
  const data = await resp.json();
  return data.data?.video_id || null;
}

// ── HeyGen avatar segment ─────────────────────────────────────────
async function heygenAvatarSegment(script, avatarId, voiceId) {
  const resp = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: {
      'x-api-key':    process.env.HEYGEN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId },
        voice:     { type: 'voice_id', voice_id: voiceId },
        script:    { type: 'text', input_text: script },
      }],
      test:         false,
      aspect_ratio: '9:16',
    }),
  });
  if (!resp.ok) throw new Error(`HeyGen avatar ${resp.status}`);
  const data = await resp.json();
  return data.data?.video_id || null;
}

// ── Build Runway scene prompts from style + framework ─────────────
function buildScenePrompts(scenes, style, framework) {
  const STYLE_SUFFIXES = {
    cinematic:   'cinematic 4K, dramatic lighting, shallow depth of field, film grain, dark moody atmosphere, professional cinematography',
    lifestyle:   'bright natural lighting, vibrant colors, luxury lifestyle aesthetic, aspirational, golden hour, 4K',
    documentary: 'handheld camera feel, authentic, close-up details, raw emotional, documentary style, natural light',
  };
  const suffix = STYLE_SUFFIXES[style] || STYLE_SUFFIXES.cinematic;
  return scenes.map(function(s) {
    return s.visualPrompt + '. ' + suffix + '. No text, no watermarks, photorealistic.';
  });
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { uid, framework, start, turn, end, style, charMode, avatarId, voiceId, voiceMode, niche, offerName } = req.body || {};

  if (!start || !turn || !end) {
    return res.status(400).json({ error: 'Story details required (start, turn, end)' });
  }

  const FRAMEWORK_DESCRIPTIONS = {
    transformation: 'A powerful transformation story — from struggle/failure to remarkable success. Emotional arc: despair → discovery → action → triumph.',
    rejection:      'A rejection-to-triumph story — repeated failures and setbacks leading to an unexpected breakthrough. Arc: repeated rejection → breaking point → discovery → victory.',
    discovery:      'A discovery story — stumbling upon something that changed everything. Arc: frustration with current situation → accidental discovery → scepticism → results → evangelism.',
    beforeafter:    'A vivid before/after contrast story — painting two worlds so clearly the audience can feel both. Arc: painful before state → moment of change → dramatic after state.',
  };

  try {
    // ── STEP 1: Generate script + scene breakdown via Claude ──────
    const scriptResp = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system:     `You are an elite short-form video scriptwriter and cinematic director. You write emotionally powerful 90-120 second story videos that stop the scroll and hook attention in the first 3 seconds. You NEVER use generic language. Every scene is viscerally specific. Return ONLY valid JSON.`,
      messages: [{
        role:    'user',
        content: `Write a cinematic story video script using this framework: ${FRAMEWORK_DESCRIPTIONS[framework] || FRAMEWORK_DESCRIPTIONS.transformation}

STORY DETAILS:
Where they started: "${start}"
The turning point: "${turn}"
Where they are now: "${end}"
${niche ? 'Niche: ' + niche : ''}
${offerName ? 'Offer: ' + offerName : ''}

REQUIREMENTS:
- Total narration: 195-240 words (reads in 90-110 seconds at natural pace)
- 8-10 scenes total, each 4-6 seconds of footage
- First 3 words must stop the scroll — no "Hey guys", no "Today I want to", no "So"
- Every scene has a visual description specific enough for AI video generation
- Narration is split into segments — each segment plays over 1-2 scenes
- No section labels, no brackets, no stage directions in the narration
- Raw, real, specific — sounds like a real person talking, not a copywriter

Return this EXACT JSON structure:
{
  "hook": "the very first sentence — under 10 words, stops the scroll cold",
  "fullNarration": "complete narration text as one flowing piece — 195-240 words, no labels",
  "scenes": [
    {
      "id": 1,
      "duration": 5,
      "visualPrompt": "highly specific visual description for AI generation — describe exactly what is seen, camera angle, action, environment, mood",
      "narrationSegment": "the exact words spoken during this scene (2-4 sentences)",
      "isAvatarScene": false
    }
  ],
  "musicMood": "one of: emotional-piano, epic-cinematic, inspirational-uplifting, raw-acoustic"
}

If charMode is "avatar", make scenes 3, 6, and 9 isAvatarScene: true (avatar speaks directly to camera).
Current charMode: ${charMode || 'cinematic'}`
      }],
    });

    const rawText = scriptResp.content?.[0]?.text || '';
    const clean   = rawText.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const s = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s < 0 || e2 < 0) throw new Error('Script generation returned invalid JSON');
    const scriptData = JSON.parse(clean.slice(s, e2+1));

    const { scenes, fullNarration, hook, musicMood } = scriptData;
    if (!scenes || !scenes.length) throw new Error('No scenes generated');

    // ── STEP 2: Submit all scenes to Runway ML (parallel) ─────────
    const scenePrompts = buildScenePrompts(scenes, style, framework);
    const runwayTaskIds = [];

    // Submit non-avatar scenes to Runway
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].isAvatarScene && charMode === 'avatar') {
        runwayTaskIds.push(null); // placeholder — avatar will be generated by HeyGen
      } else {
        try {
          const taskId = await runwayGenerateScene(scenePrompts[i], scenes[i].duration || 5);
          runwayTaskIds.push(taskId);
        } catch(e) {
          console.warn(`[story-video] Scene ${i+1} Runway failed:`, e.message);
          runwayTaskIds.push(null);
        }
        // Small delay between Runway calls to avoid rate limiting
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ── STEP 3: Submit voiceover to HeyGen ───────────────────────
    let voiceJobId = null;
    try {
      if (voiceMode === 'clone' || voiceMode === 'heygen') {
        voiceJobId = await heygenVoiceover(fullNarration, voiceId);
      }
    } catch(e) {
      console.warn('[story-video] Voiceover failed:', e.message);
    }

    // ── STEP 4: Submit avatar segments to HeyGen (if avatar mode) ─
    const avatarJobIds = {};
    if (charMode === 'avatar' && avatarId && voiceId) {
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].isAvatarScene) {
          try {
            const avatarJobId = await heygenAvatarSegment(scenes[i].narrationSegment, avatarId, voiceId);
            avatarJobIds[i] = avatarJobId;
          } catch(e) {
            console.warn(`[story-video] Avatar scene ${i+1} failed:`, e.message);
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    // ── STEP 5: Save job to Firestore for polling ─────────────────
    const jobId = 'sv_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const jobData = {
      jobId,
      uid:          uid || null,
      status:       'processing',
      framework,
      style,
      charMode:     charMode || 'cinematic',
      scriptData,
      fullNarration,
      hook,
      musicMood:    musicMood || 'inspirational-uplifting',
      runwayTaskIds,
      voiceJobId,
      avatarJobIds,
      scenes,
      createdAt:    FieldValue.serverTimestamp(),
      sceneUrls:    {},   // filled in by status polling
      voiceUrl:     null,
      finalVideoUrl:null,
    };

    const db = getDb();
    await db.collection('storyJobs').doc(jobId).set(jobData);

    return res.status(200).json({
      ok:          true,
      jobId,
      sceneCount:  scenes.length,
      narration:   fullNarration,
      hook,
      runwayTaskIds,
      voiceJobId,
      avatarJobIds,
    });

  } catch(err) {
    console.error('[story-video] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
