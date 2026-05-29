// api/automate.js — Execution OS Automate Tab
// Generates one full day of content per call.
// The app calls this endpoint in a loop (day 1 → day 30), updating the
// progress UI after each response. One day ≈ 30–60 seconds — well within
// the 300-second maxDuration already set in vercel.json.
//
// POST body: { uid, dayNumber, job }
//   uid        — Firebase user ID
//   dayNumber  — which day to generate (1-based)
//   job        — { duration, contentTypes, cloneIds, rotationStyle, isAffiliate }
//
// Returns: { ok, dayNumber, isComplete, progress }

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-20250514';

// ── Firebase — same pattern as execution-engine.js ───────────────────────────
function getDb() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })});
  }
  return getFirestore();
}

// ── Core AI call — same pattern as execution-engine.js ───────────────────────
async function ai(system, user, maxTokens) {
  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: maxTokens || 1000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content?.[0]?.text || '';
}

function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{');
  const e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return null; }
}

// ── Load user intelligence from Firestore ────────────────────────────────────
async function loadIntelligence(uid, isAffiliate) {
  const defaults = {
    niche:          'Online Business',
    offerName:      'My Offer',
    price:          997,
    pain:           'their biggest challenge',
    transformation: 'their desired outcome',
    pillars:        ['Authority', 'Story', 'Value', 'Offer'],
    hooks:          ['The truth about X', 'Why most people fail at X', 'What nobody tells you about X'],
    voiceNotes:     '',
  };

  try {
    const db   = getDb();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return defaults;

    const d  = snap.data();
    const bi = d.boardroomIntel || {};
    const ce = bi.contentEngine || {};
    const cv = bi.copyVault     || {};
    const av = d.avatarData     || {};
    const inp= bi.inputs        || {};
    const vp = d.voiceProfile   || {};

    if (isAffiliate) {
      const ao   = d.affiliateOffer || {};
      const affCE= d.affContentStrategy || {};
      return {
        niche:          ao.niche       || defaults.niche,
        offerName:      ao.name        || defaults.offerName,
        price:          ao.commission  || defaults.price,
        pain:           ao.pain        || defaults.pain,
        transformation: ao.transformation || defaults.transformation,
        pillars:        Array.isArray(affCE.pillars) ? affCE.pillars : defaults.pillars,
        hooks:          Array.isArray(affCE.hooks)   ? affCE.hooks   : defaults.hooks,
        voiceNotes:     vp.notes || '',
      };
    }

    return {
      niche:          inp.niche          || defaults.niche,
      offerName:      inp.offerName      || d.boardroomLastOfferName || defaults.offerName,
      price:          inp.price          || defaults.price,
      pain:           av.pain            || inp.av_pain      || defaults.pain,
      transformation: av.transformation  || inp.transformation || defaults.transformation,
      pillars:        Array.isArray(ce.pillars) ? ce.pillars : defaults.pillars,
      hooks:          Array.isArray(cv.hooks)   ? cv.hooks   : defaults.hooks,
      voiceNotes:     vp.notes || '',
    };
  } catch(e) {
    console.warn('[automate] loadIntelligence failed:', e.message);
    return defaults;
  }
}

// ── Rotation helpers ─────────────────────────────────────────────────────────
function getCloneForDay(day, cloneIds, rotation) {
  if (!cloneIds || !cloneIds.length) return null;
  if (rotation === 'random')    return cloneIds[Math.floor(Math.random() * cloneIds.length)];
  if (rotation === 'alternate') return cloneIds[(day - 1) % Math.min(2, cloneIds.length)];
  return cloneIds[(day - 1) % cloneIds.length];
}

function getPillarForDay(day, pillars) {
  if (!pillars || !pillars.length) return 'Value';
  return pillars[(day - 1) % pillars.length];
}

function getHookForDay(day, hooks) {
  if (!hooks || !hooks.length) return 'The truth about this';
  return hooks[(day - 1) % hooks.length];
}

// ── Content generators ───────────────────────────────────────────────────────
async function genFBPost1(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Facebook content writer for ${intel.niche}. Write posts that educate, build authority, and attract qualified leads. Never use hashtags in Facebook posts. Return only the post text — no labels, no preamble.${intel.voiceNotes ? '\n\nVOICE: ' + intel.voiceNotes : ''}`,
    `Write a Facebook post for Day ${day}.\nContent pillar: ${pillar}\nHook angle: ${hook}\nAudience pain: ${intel.pain}\nOffer: ${intel.offerName}\n\nOpen with a scroll-stopping hook. Teach one specific thing. End with a soft CTA to comment or DM. 150-250 words.`,
    700
  );
  const caps = await genCaptionAndHashtags(intel, pillar);
  return { type: 'FB Post 1', content: text, status: 'ready', scheduledTime: '6:00am', ...caps };
}

async function genFBPost2(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Facebook copywriter for ${intel.niche}. Write posts that build desire and drive DM conversations. Return only the post text.${intel.voiceNotes ? '\n\nVOICE: ' + intel.voiceNotes : ''}`,
    `Write a second Facebook post for Day ${day}.\nContent pillar: ${pillar}\nAngle: Use a personal story or client result — different angle from the morning post.\nOffer: ${intel.offerName} ($${intel.price})\nTransformation: ${intel.transformation}\n\nEnd with a direct CTA to DM for more info. 100-150 words.`,
    500
  );
  const caps = await genCaptionAndHashtags(intel, pillar);
  return { type: 'FB Post 2', content: text, status: 'ready', scheduledTime: '3:00pm', ...caps };
}

async function genReelScript(intel, pillar, hook, day, reelNum) {
  const isStory = reelNum === 2;
  const prompt  = isStory
    ? `Write a 60-second Reel script in storytelling format for Day ${day}.\nOpen with a personal or client story related to: ${pillar}.\nConnect the story to how ${intel.offerName} solves ${intel.pain}.\nEnd with a strong CTA.\nEach sentence on its own line. No stage directions. No hashtags.`
    : `Write a 60-second Reel script for Day ${day}.\nOpen with this hook angle: "${hook}"\nTeach one specific thing from this content pillar: ${pillar}\nAudience pain: ${intel.pain}\nEnd with a CTA mentioning ${intel.offerName}.\nEach sentence on its own line. Natural conversational language.`;
  const text = await ai(
    `You are a short-form video scriptwriter for ${intel.niche}. Write tight 60-second teleprompter scripts. Each sentence on its own line. No stage directions.${intel.voiceNotes ? '\n\nVOICE: ' + intel.voiceNotes : ''}`,
    prompt,
    600
  );
  const caps = await genCaptionAndHashtags(intel, pillar);
  return {
    type:          `Reel ${reelNum}`,
    script:        text,
    status:        'ready',
    scheduledTime: reelNum === 1 ? '9:00am' : '6:00pm',
    ...caps,
  };
}

async function genEmail(intel, pillar, day) {
  const text = await ai(
    `You are an email copywriter for ${intel.niche}. Write emails that teach one thing and connect it to the offer. Return ONLY valid JSON — no markdown, no fences.`,
    `Write a marketing email for Day ${day}.\nContent pillar: ${pillar}\nOffer: ${intel.offerName}\nTransformation: ${intel.transformation}\n\nReturn: { "subject": "compelling subject line", "body": "full email — teach one thing from the pillar, connect it to the offer transformation, end with CTA. 200-300 words." }`,
    900
  );
  const data = extractJSON(text) || {};
  return {
    type:          'Email',
    subject:       data.subject || `${pillar} — Day ${day}`,
    content:       data.body    || text,
    status:        'ready',
    scheduledTime: '8:00pm',
  };
}

async function genCarousel(intel, pillar, hook, day) {
  const text = await ai(
    `You are a carousel copywriter for ${intel.niche}. Return ONLY valid JSON — no markdown, no code fences, no explanation.`,
    `Write a 6-slide Instagram carousel for Day ${day}.\nContent pillar: ${pillar}\nHook angle: ${hook}\nOffer: ${intel.offerName}\nAudience pain: ${intel.pain}\n\nReturn exactly:\n{\n  "hook": "viral slide 1 headline — max 8 words",\n  "slides": [\n    { "headline": "max 7 words", "body": "max 20 words" },\n    { "headline": "...", "body": "..." },\n    { "headline": "...", "body": "..." },\n    { "headline": "...", "body": "..." }\n  ],\n  "cta": "final slide CTA tied to the offer",\n  "caption_hook": "opening caption line — different from slide hook",\n  "caption_body": "3-4 sentences — value + story + connection to offer",\n  "caption_cta": "caption closing CTA",\n  "hashtags": ["tag1","tag2"]\n}\nslides array must have exactly 4 items. hashtags: 30 strings, no # symbols.`,
    1500
  );
  const data = extractJSON(text) || {};
  const captionFull = [data.caption_hook, data.caption_body, data.caption_cta].filter(Boolean).join('\n\n');
  const hashtagsStr = (data.hashtags || []).map(t => '#' + t.replace(/^#/, '')).join(' ');
  return {
    type:          'Carousel',
    slideData:     data,               // full JSON for client-side canvas rendering
    hook:          data.hook    || '',
    caption:       captionFull,
    hashtags:      hashtagsStr,
    status:        'ready',
    scheduledTime: '12:00pm',
  };
}

async function genCaptionAndHashtags(intel, pillar) {
  const text = await ai(
    'You are a social media copywriter. Return ONLY valid JSON — no markdown, no fences.',
    `Write a caption and 30 hashtags for a post about "${pillar}" in ${intel.niche}.\nReturn: { "caption": "2-3 sentence caption with value and CTA", "hashtags": ["tag1","tag2",...] }\nHashtags: exactly 30 strings, no # symbols — 10 large (1M+ posts), 10 medium (100K-1M), 10 niche-specific.`,
    500
  );
  const data = extractJSON(text) || {};
  return {
    caption:  data.caption || '',
    hashtags: (data.hashtags || []).map(t => '#' + t.replace(/^#/, '')).join(' '),
  };
}

// ── HeyGen submit — calls existing api/heygen route ──────────────────────────
async function submitToHeyGen(script, avatarId, origin) {
  if (!avatarId || !process.env.HEYGEN_API_KEY) return null;
  try {
    const resp = await fetch('https://api.heygen.com/v2/video/generate', {
      method:  'POST',
      headers: { 'x-api-key': process.env.HEYGEN_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_inputs: [{
          character: { type: 'avatar', avatar_id: avatarId },
          voice:     { type: 'text', input_text: script },
        }],
        test:         false,
        aspect_ratio: '9:16',
        resolution:   '1080p',
      }),
    });
    const data = await resp.json();
    return data.data?.video_id || null;
  } catch(e) {
    console.warn('[automate] HeyGen submit error:', e.message);
    return null;
  }
}

// ── Write day content to Firestore ───────────────────────────────────────────
async function saveDayToFirestore(uid, dayNumber, dayContent) {
  const db = getDb();
  await db
    .collection('calendar').doc(uid)
    .collection('days').doc(`day${dayNumber}`)
    .set(dayContent, { merge: true });
}

// ── Update job progress ───────────────────────────────────────────────────────
async function updateJobProgress(uid, dayNumber, totalDays, isComplete) {
  const db     = getDb();
  const jobRef = db.collection('automationJobs').doc(uid).collection('currentJob').doc('job');
  await jobRef.update({
    'progress.daysComplete':  dayNumber,
    'progress.currentAction': isComplete
      ? 'All content generated!'
      : `Day ${dayNumber} complete — ${totalDays - dayNumber} days remaining`,
    status:    isComplete ? 'complete' : 'running',
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Write completion notification when done
  if (isComplete) {
    await db.collection('users').doc(uid).set({
      notifications: {
        autoComplete: {
          message:   `Your ${totalDays}-day content machine is ready!`,
          createdAt: FieldValue.serverTimestamp(),
          dismissed: false,
        },
      },
    }, { merge: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { uid, dayNumber, job } = req.body || {};

  if (!uid)       return res.status(400).json({ error: 'uid required' });
  if (!dayNumber) return res.status(400).json({ error: 'dayNumber required' });
  if (!job)       return res.status(400).json({ error: 'job required' });

  const totalDays  = job.duration   || 30;
  const types      = job.contentTypes || {};
  const cloneIds   = job.cloneIds   || [];
  const rotation   = job.rotationStyle || 'sequential';
  const isAffiliate= !!job.isAffiliate;

  console.log(`[automate] uid=${uid} day=${dayNumber}/${totalDays}`);

  try {
    // ── Load intelligence ─────────────────────────────────────────────────
    const intel  = await loadIntelligence(uid, isAffiliate);
    const cloneId = getCloneForDay(dayNumber, cloneIds, rotation);
    const pillar  = getPillarForDay(dayNumber, intel.pillars);
    const hook    = getHookForDay(dayNumber, intel.hooks);

    // ── Generate all enabled content types in parallel where safe ─────────
    const dayContent = {};

    // Run written content in parallel (no dependencies between them)
    const parallelJobs = [];

    if (types.fb1)      parallelJobs.push(genFBPost1(intel, pillar, hook, dayNumber).then(r => { dayContent.fb1      = r; }));
    if (types.fb2)      parallelJobs.push(genFBPost2(intel, pillar, hook, dayNumber).then(r => { dayContent.fb2      = r; }));
    if (types.email)    parallelJobs.push(genEmail(intel, pillar, dayNumber).then(r => {         dayContent.email    = r; }));
    if (types.carousel) parallelJobs.push(genCarousel(intel, pillar, hook, dayNumber).then(r => { dayContent.carousel = r; }));
    if (types.reel1)    parallelJobs.push(genReelScript(intel, pillar, hook, dayNumber, 1).then(r => { dayContent.reel1 = r; }));
    if (types.reel2)    parallelJobs.push(genReelScript(intel, pillar, hook, dayNumber, 2).then(r => { dayContent.reel2 = r; }));

    await Promise.all(parallelJobs);

    // ── Submit reels to HeyGen after scripts are ready ────────────────────
    if (types.reel1 && dayContent.reel1 && cloneId) {
      const vid1 = await submitToHeyGen(dayContent.reel1.script, cloneId);
      if (vid1) {
        dayContent.reel1.heygenJobId = vid1;
        dayContent.reel1.status      = 'rendering';
      }
    }
    if (types.reel2 && dayContent.reel2) {
      // Alternate clone for reel 2 if available
      const clone2 = getCloneForDay(dayNumber + 1, cloneIds, rotation);
      const vid2   = await submitToHeyGen(dayContent.reel2.script, clone2 || cloneId);
      if (vid2) {
        dayContent.reel2.heygenJobId = vid2;
        dayContent.reel2.status      = 'rendering';
      }
    }

    // ── Save to Firestore ─────────────────────────────────────────────────
    const isComplete = dayNumber >= totalDays;
    await Promise.all([
      saveDayToFirestore(uid, dayNumber, dayContent),
      updateJobProgress(uid, dayNumber, totalDays, isComplete),
    ]);

    return res.status(200).json({
      ok:         true,
      dayNumber,
      totalDays,
      isComplete,
      progress: {
        daysComplete:  dayNumber,
        percentComplete: Math.round((dayNumber / totalDays) * 100),
        currentAction: isComplete ? 'All content generated!' : `Day ${dayNumber} complete`,
      },
      contentGenerated: Object.keys(dayContent),
    });

  } catch(err) {
    console.error(`[automate] day ${dayNumber} error:`, err.message);
    return res.status(500).json({ ok: false, error: err.message, dayNumber });
  }
};
