/**
 * POST /api/story-video
 *
 * Fire-and-return architecture:
 *  1. Generate cinematic script via Claude (fast, ~2-3s)
 *  2. Build scene prompts
 *  3. Submit each scene to Runway Gen-3 (returns taskId immediately — no waiting)
 *  4. Write job document to Firestore with status: 'processing'
 *  5. Return { ok: true, jobId } to client immediately
 *
 * Completion is handled by /api/story-video-webhook (Runway callback)
 * or polled via /api/story-video-status (reads Firestore).
 *
 * This keeps the Vercel function well under the 10s / 60s execution limit.
 */

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Admin init ───────────────────────────────────────────
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

// ── Runway helper ─────────────────────────────────────────────────
const RUNWAY_API   = 'https://api.dev.runwayml.com/v1';
const RUNWAY_KEY   = process.env.RUNWAY_API_KEY;
const RUNWAY_MODEL = 'gen3a_turbo'; // or 'gen4_turbo'

async function submitRunwayScene(textPrompt, durationSeconds = 5) {
  const resp = await fetch(`${RUNWAY_API}/image_to_video`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RUNWAY_KEY}`,
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify({
      model:          RUNWAY_MODEL,
      promptText:     textPrompt,
      duration:       durationSeconds,
      ratio:          '720:1280', // 9:16 vertical
      watermark:      false,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Runway scene submit failed: ${resp.status} — ${err}`);
  }
  const data = await resp.json();
  // Runway returns { id: 'task_xxx', status: 'PENDING', ... }
  return data.id;
}

// ── Claude script generation ──────────────────────────────────────
async function generateCinematicScript(body) {
  const {
    framework = 'hsa', start, turn, end, style = 'cinematic',
    niche, offerName, pain, transformation, deeperPain,
    fear, tried, identity, dominanceAngle, positioning,
    contentAngles, hooks, voiceContext, isAffiliate,
  } = body;

  const frameworkDescriptions = {
    hsa: 'Hook → Story → Ask. Open with a single cinematic hook image, build through a transformation story, close with a soft invitation.',
    pas: 'Problem → Agitate → Solution. Make the problem vivid and painful, deepen the emotional wound, then reveal the relief.',
    aida:'Attention → Interest → Desire → Action. Arrest the eye, build fascination, create desire, deliver a clear call.',
    before_after: 'Before / After. Two worlds — the darkness before, the light after. The contrast does the selling.',
  };

  const styleGuide = {
    cinematic: 'Ultra-cinematic. Each scene is a single striking image — strong shadow, dramatic light, shallow depth of field. Think A24 or luxury brand campaign.',
    documentary:'Raw and real. Handheld feel. Natural light. Authentic faces. Intimate and unpolished on purpose.',
    minimal:   'Clean and stark. Lots of negative space. Minimalist props. Bold, quiet tension.',
    viral:     'Fast-paced, high-energy. Unexpected angles. Quick cuts implied. Designed to stop the scroll instantly.',
  };

  const systemPrompt = `You are a world-class cinematic story director writing visual scene descriptions for a short-form video ad. 
Your scenes will be sent directly to Runway AI for image-to-video generation.
Each scene description must be a single, vivid visual moment — described as a cinematographer would describe it to a camera operator.
No dialogue. No text overlays. No narration in the scene descriptions. Pure visual storytelling.
You are working in the ${niche || 'online business'} niche.
Style guide: ${styleGuide[style] || styleGuide.cinematic}`;

  const prompt = `STORY BRIEF:
Framework: ${frameworkDescriptions[framework] || frameworkDescriptions.hsa}
Opening situation (where the character IS): ${start}
Turning point (what CHANGES or is DISCOVERED): ${turn}
Resolution (where they END UP / the transformation): ${end}

AUDIENCE CONTEXT:
Pain point: ${pain || ''}
Deeper emotional wound: ${deeperPain || ''}
Transformation they want: ${transformation || ''}
Deepest fear: ${fear || ''}
What they have tried before: ${tried || ''}
How they see themselves: ${identity || ''}
${dominanceAngle ? 'Unique positioning angle: ' + dominanceAngle : ''}
${voiceContext ? '\n' + voiceContext : ''}

TASK:
Write exactly 5 scene descriptions and a narration script.

Respond ONLY with valid JSON in this exact shape — no markdown, no preamble:
{
  "scenes": [
    { "id": 1, "prompt": "<cinematographer-level visual description>", "duration": 5 },
    { "id": 2, "prompt": "<visual description>", "duration": 5 },
    { "id": 3, "prompt": "<visual description>", "duration": 5 },
    { "id": 4, "prompt": "<visual description>", "duration": 5 },
    { "id": 5, "prompt": "<visual description>", "duration": 5 }
  ],
  "narration": "<60-90 word voiceover script — spoken words only, no stage directions, no labels>"
}

Scene requirements:
- Each prompt is 1-3 sentences, purely visual — no character names, no dialogue, no text overlays
- Scenes must flow as a coherent story arc following the framework above
- Make each scene visually distinct — vary the shot distance (wide / medium / close-up) across the 5 scenes
- Style: ${styleGuide[style] || styleGuide.cinematic}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1200,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw = (msg.content[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── Main handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    // 1. Generate cinematic script + scene prompts via Claude
    let scriptData;
    try {
      scriptData = await generateCinematicScript(body);
    } catch (e) {
      console.error('[story-video] Claude script error:', e.message);
      return res.status(500).json({ ok: false, error: 'Script generation failed: ' + e.message });
    }

    const { scenes, narration } = scriptData;
    if (!scenes || scenes.length === 0) {
      return res.status(500).json({ ok: false, error: 'No scenes returned from script generation.' });
    }

    // 2. Submit all scenes to Runway concurrently (each call returns a taskId in <1s)
    let runwayTasks;
    try {
      runwayTasks = await Promise.all(
        scenes.map(scene => submitRunwayScene(scene.prompt, scene.duration || 5))
      );
    } catch (e) {
      console.error('[story-video] Runway submit error:', e.message);
      return res.status(500).json({ ok: false, error: 'Runway submission failed: ' + e.message });
    }

    // 3. Build job document and write to Firestore
    const jobId   = `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const jobDoc  = {
      jobId,
      uid:           body.uid || null,
      status:        'processing',
      progress:      10,
      statusLabel:   'Scenes submitted to Runway…',
      narration,
      scenes:        scenes.map((s, i) => ({
        id:          s.id,
        prompt:      s.prompt,
        duration:    s.duration || 5,
        runwayTaskId: runwayTasks[i],
        status:      'pending',
        videoUrl:    null,
      })),
      // Context stored for webhook enrichment
      niche:         body.niche        || '',
      offerName:     body.offerName    || '',
      style:         body.style        || 'cinematic',
      charMode:      body.charMode     || 'stock',
      avatarId:      body.avatarId     || null,
      voiceId:       body.voiceId      || null,
      voiceMode:     body.voiceMode    || 'heygen',
      framework:     body.framework    || 'hsa',
      createdAt:     FieldValue.serverTimestamp(),
      updatedAt:     FieldValue.serverTimestamp(),
      finalVideoUrl: null,
      error:         null,
    };

    await db.collection('story_video_jobs').doc(jobId).set(jobDoc);
    console.log(`[story-video] Job ${jobId} created with ${runwayTasks.length} Runway tasks`);

    // 4. Return immediately — client polls /api/story-video-status
    return res.status(200).json({ ok: true, jobId, sceneCount: scenes.length });

  } catch (err) {
    console.error('[story-video] Unhandled error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
}
