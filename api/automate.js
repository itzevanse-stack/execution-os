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
    const ar = bi.architect     || {};
    const wp = bi.warPlan       || {};
    const icp= bi.icpResearch   || {};

    if (isAffiliate) {
      const ao   = d.affiliateOffer || {};
      const affCE= d.affContentStrategy || {};
      return {
        niche:          ao.niche       || defaults.niche,
        offerName:      ao.name        || defaults.offerName,
        price:          ao.commission  || defaults.price,
        pain:           ao.pain        || defaults.pain,
        deeperPain:     ao.deeperPain  || '',
        fear:           ao.fear        || 'wasting more time and money without results',
        tried:          ao.tried       || 'other approaches that promised results but failed',
        transformation: ao.transformation || defaults.transformation,
        identity:       ao.identity    || '',
        pillars:        Array.isArray(affCE.pillars) ? affCE.pillars : defaults.pillars,
        hooks:          Array.isArray(affCE.hooks)   ? affCE.hooks   : defaults.hooks,
        dominanceAngle: ao.dominanceAngle || '',
        voiceNotes:     vp.notes || (vp.tone ? 'Tone: ' + vp.tone + (vp.style ? ' | Style: ' + vp.style : '') + (vp.words ? ' | Use: ' + vp.words : '') + (vp.avoid ? ' | Avoid: ' + vp.avoid : '') : ''),
      };
    }

    return {
      niche:          inp.niche          || defaults.niche,
      offerName:      inp.offerName      || d.boardroomLastOfferName || defaults.offerName,
      price:          inp.price          || defaults.price,
      pain:           av.pain            || inp.av_pain      || defaults.pain,
      deeperPain:     av.deeperPain      || icp.emotionalWound || '',
      fear:           av.fear            || icp.deepestFear  || 'staying stuck and watching others succeed',
      tried:          av.tried           || 'multiple courses and programmes that never delivered',
      transformation: av.transformation  || inp.transformation || defaults.transformation,
      identity:       av.identity        || icp.identityAspiration || '',
      pillars:        Array.isArray(ce.pillars) ? ce.pillars : defaults.pillars,
      hooks:          Array.isArray(cv.hooks)   ? cv.hooks   : defaults.hooks,
      dominanceAngle: ar.dominanceAngle  || ar.positioningStatement || wp.dominanceAngle || '',
      voiceNotes:     vp.notes || (vp.tone ? 'Tone: ' + vp.tone + (vp.style ? ' | Style: ' + vp.style : '') + (vp.words ? ' | Use: ' + vp.words : '') + (vp.avoid ? ' | Avoid: ' + vp.avoid : '') : ''),
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
// ── FB Post 1 — Long-form authority/value post (morning) ─────────
// Target: 500-700 words. Framework-based. Teaches something real.
// No hashtags. Ends with comment CTA.
async function genFBPost1(intel, pillar, hook, day) {

  const FRAMEWORKS = [
    `PROBLEM → INSIGHT → FRAMEWORK post. Open by naming the exact problem your audience is struggling with right now — in their words, not yours. Then reveal the one insight that shifts how they see the problem. Then give a clear 3-part framework or list that solves it. Each point must be specific and actionable. End with a comment CTA that uses a keyword (e.g. "Comment SYSTEM below").`,
    `STORY → LESSON → APPLICATION post. Open mid-story — a real moment of struggle or turning point. Never start with "I". Pull them into the story in the first line. Tell what happened, what you learned, and then show exactly how they can apply that lesson to their own situation. End by asking them to share their experience in the comments.`,
    `MYTH → TRUTH → PROOF post. Name the dangerous belief most people in ${intel.niche} have about ${pillar}. State it boldly. Then destroy it completely with the truth, backed by logic or experience. Then prove the truth with a specific result or example. End with a question that invites debate.`,
    `THE ONLY 3 THINGS THAT MATTER post. Open with a bold claim about what really drives success in ${intel.niche}. Name the 3 things. Explain each one with real depth — not platitudes, but specific insight. End with a soft CTA tied to ${intel.offerName}.`,
  ];

  const framework = FRAMEWORKS[(day - 1) % FRAMEWORKS.length];

  const system = `You are a world-class Facebook copywriter who writes long-form posts that stop the scroll, hold attention, and build a loyal audience of buyers. You write for the ${intel.niche} niche.

WRITING RULES — NEVER BREAK THESE:
• 500-700 words. Long-form works on Facebook when every word earns its place.
• NEVER start with "I" — start mid-thought, mid-story, or with a bold claim
• NO emojis scattered throughout — you may use 1-2 maximum, only where they genuinely add emphasis
• NO hashtags in the post body — Facebook penalises them
• NO bullet points that are lazy — every point must be a complete thought with real substance
• NO generic phrases: no "game changer", "level up", "journey", "hustle", "grind", "passion"
• Write in a voice that sounds like a smart, successful friend talking directly to one person
• Every paragraph must make the reader want to read the next one
• The CTA at the end must feel natural — never forced or salesy
${intel.voiceNotes ? '\nVOICE PROFILE (match this exactly):\n' + intel.voiceNotes : ''}`;

  const prompt = `Write a Facebook post for Day ${day} using this framework:
${framework}

BUSINESS INTELLIGENCE:
Niche: ${intel.niche}
Offer: ${intel.offerName} ($${intel.price})
Content pillar: ${pillar}
Hook angle: ${hook}

AUDIENCE PSYCHOLOGY (use this to make every word hit harder):
Their exact pain: ${intel.pain}
Deeper emotional wound: ${intel.deeperPain || 'feeling behind and left out while watching others succeed'}
Their deepest fear: ${intel.fear || 'that they will never figure this out'}
What they have already tried: ${intel.tried || 'other programmes that promised results but delivered theory'}
The transformation they want: ${intel.transformation}
How they see themselves: ${intel.identity || 'someone who is smart and capable but has not found the right system yet'}
${intel.dominanceAngle ? 'Your unique positioning angle: ' + intel.dominanceAngle : ''}

Write the complete post now. Output only the post text — no labels, no preamble, no "Here is the post:". Just the words.`;

  const text = await ai(system, prompt, 1500);
  const caps  = await genCaptionAndHashtags(intel, pillar);
  return {
    type:          'FB Post 1',
    content:       text,
    status:        'ready',
    scheduledTime: withTz('6:00am'),
    ...caps,
  };
}

// ── FB Post 2 — Story-driven desire post (afternoon) ─────────────
// Target: 300-450 words. Personal story. Drives DM conversations.
async function genFBPost2(intel, pillar, hook, day) {

  const STORY_ANGLES = [
    `Write a BEFORE/AFTER story post. Paint the before state in vivid, specific detail — exactly what it felt and looked like to be stuck in ${intel.pain}. Then show the after state — what changed, what it feels like now, what ${intel.transformation} actually looks like in real life. Bridge them with the single turning point. End by inviting them to DM you.`,
    `Write a CLIENT RESULT story post. Tell the story of someone (a client, a person you know, or yourself framed as a client journey) who went from ${intel.pain} to ${intel.transformation}. Be specific about the before — their situation, their doubts, what they had tried. Be specific about the after — real outcomes, real feelings. Do not name the product until the very end, if at all. End with a DM CTA.`,
    `Write a TURNING POINT story post. Describe the exact moment everything changed. What you were doing, where you were, what you were feeling right before the shift happened. Then what you discovered. Then what happened after. Make it so specific and real that the reader feels they are living it with you. End with "If this sounds like where you are right now, DM me the word [keyword]."`,
  ];

  const angle = STORY_ANGLES[(day - 1) % STORY_ANGLES.length];

  const system = `You are an expert Facebook storyteller who builds desire and drives real conversations. You write for ${intel.niche}.

RULES:
• 300-450 words
• Start with the most emotionally resonant line — not "I want to tell you a story"
• Raw and real — sounds like a confessional, not a sales post
• Zero salesy language — desire is built through truth, not hype
• End with a DM CTA that feels like a natural invitation, not a push
${intel.voiceNotes ? '\nVOICE PROFILE:\n' + intel.voiceNotes : ''}`;

  const prompt = `${angle}

INTELLIGENCE:
Niche: ${intel.niche}
Offer: ${intel.offerName}
Their pain: ${intel.pain}
Their fear: ${intel.fear || 'being stuck here forever'}
Their tried: ${intel.tried || 'multiple programmes without results'}
Transformation: ${intel.transformation}
${intel.dominanceAngle ? 'Positioning: ' + intel.dominanceAngle : ''}

Output only the post text.`;

  const text = await ai(system, prompt, 1000);
  const caps  = await genCaptionAndHashtags(intel, pillar);
  return {
    type:          'FB Post 2',
    content:       text,
    status:        'ready',
    scheduledTime: withTz('3:00pm'),
    ...caps,
  };
}

// ── Reel Script + Caption ─────────────────────────────────────────
async function genReelScript(intel, pillar, hook, day, reelNum) {
  const isStory = reelNum === 2;

  const scriptPrompt = isStory
    ? `Write a 90-second storytelling Reel script for Day ${day}.

ANGLE: Personal journey story — from ${intel.pain} to ${intel.transformation}.

RULES:
• 170-200 words — reads in exactly 90 seconds at natural pace
• First sentence stops the scroll in under 3 words — no "Hey guys", no "So today", no "Welcome back"
• Each sentence on its own line
• Raw, real, conversational — sounds like one person talking to one person
• No labels, no stage directions, no brackets
• Final line: a low-friction CTA ("link in bio", or "comment [keyword]")

Niche: ${intel.niche}
Their pain: ${intel.pain}
Their tried: ${intel.tried || 'other approaches'}
Transformation: ${intel.transformation}
${intel.voiceNotes ? 'Voice: ' + intel.voiceNotes : ''}

Output only the spoken words.`
    : `Write a 90-second value/education Reel script for Day ${day}.

HOOK ANGLE: ${hook}
CONTENT PILLAR: ${pillar}

RULES:
• 170-200 words — reads in 90 seconds
• First sentence is a bold claim or pattern interrupt — not a greeting
• Each sentence on its own line
• Teach ONE specific insight from ${pillar} that most people in ${intel.niche} get wrong
• Reference their pain (${intel.pain}) naturally
• Final 2 lines: connect to ${intel.offerName} and give a clear action
${intel.voiceNotes ? 'Voice: ' + intel.voiceNotes : ''}

Output only the spoken words.`;

  const script = await ai(
    `You are an elite short-form video scriptwriter for ${intel.niche}. Every word earns its place. No stage directions. No labels. Just clean spoken words.`,
    scriptPrompt,
    700
  );

  // Generate a powerful reel caption — not just 2-3 sentences
  const captionData = await genReelCaption(intel, pillar, hook, script);

  return {
    type:          `Reel ${reelNum}`,
    script,
    status:        'ready',
    scheduledTime: withTz(reelNum === 1 ? '9:00am' : '6:00pm'),
    caption:       captionData.caption,
    hashtags:      captionData.hashtags,
  };
}

// ── Reel Caption — full-depth, not 2-3 generic sentences ─────────
async function genReelCaption(intel, pillar, hook, script) {
  const text = await ai(
    `You are a social media caption writer for ${intel.niche}. You write captions that stop people from scrolling past, make them watch the video, and drive comments. Return ONLY valid JSON — no markdown, no fences.`,
    `Write a powerful Instagram/Facebook Reel caption.

CONTEXT:
Niche: ${intel.niche}
Content pillar: ${pillar}
Hook angle: ${hook}
Audience pain: ${intel.pain}
Offer: ${intel.offerName}
${script ? 'Reel script opening lines:\n' + script.split('\n').slice(0,4).join('\n') : ''}

CAPTION RULES:
• Open with a hook line that makes them NEED to watch the video (not "check out my latest reel")
• 3-5 paragraphs — teach or tease something real
• Mid-caption: a line that makes them comment or tag someone
• End with a CTA that matches the video content
• Natural, conversational — not corporate
• Include 30 hashtags (10 large 1M+, 10 medium 100K-1M, 10 niche-specific)

Return:
{
  "caption": "full caption text — hook + body + CTA",
  "hashtags": ["tag1","tag2",...30 total, no # symbols]
}`,
    800
  );
  const data = extractJSON(text) || {};
  return {
    caption:  data.caption  || '',
    hashtags: (data.hashtags || []).map(t => '#' + t.replace(/^#/, '')).join(' '),
  };
}

// ── Email ─────────────────────────────────────────────────────────
async function genEmail(intel, pillar, day) {
  const text = await ai(
    `You are an email copywriter for ${intel.niche}. You write emails that feel like a personal message from a knowledgeable friend, not a marketing blast. Return ONLY valid JSON.`,
    `Write a marketing email for Day ${day}.

CONTENT PILLAR: ${pillar}
OFFER: ${intel.offerName}
AUDIENCE PAIN: ${intel.pain}
TRANSFORMATION: ${intel.transformation}
${intel.tried ? 'WHAT THEY HAVE TRIED: ' + intel.tried : ''}
${intel.voiceNotes ? 'VOICE: ' + intel.voiceNotes : ''}

EMAIL STRUCTURE:
• Subject line: personal, specific, curiosity-driven — NOT clickbait, NOT "RE:", NOT excessive caps
• Opening: first line hooks them — treat it like a post hook
• Body: teach ONE genuinely useful insight from ${pillar} — with a real example or story
• Bridge: connect that insight to how ${intel.offerName} accelerates or completes it
• CTA: soft and specific — tell them exactly what to do and why now
• 250-350 words total

Return: { "subject": "...", "preheader": "preview text 50-80 chars", "body": "full email — paragraphs separated by \\n\\n" }`,
    1000
  );
  const data = extractJSON(text) || {};
  return {
    type:          'Email',
    subject:       data.subject   || `${pillar} — Day ${day}`,
    preheader:     data.preheader || '',
    content:       data.body      || text,
    status:        'ready',
    scheduledTime: withTz('8:00pm'),
  };
}

// ── Carousel ──────────────────────────────────────────────────────
async function genCarousel(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Instagram carousel copywriter for ${intel.niche}. You write carousels that get saved, shared, and drive profile visits. Return ONLY valid JSON — no markdown, no fences.`,
    `Write a 6-slide Instagram carousel for Day ${day}.

INTELLIGENCE:
Content pillar: ${pillar}
Hook angle: ${hook}
Offer: ${intel.offerName}
Audience pain: ${intel.pain}
Their tried: ${intel.tried || 'multiple programmes'}
Transformation: ${intel.transformation}
${intel.dominanceAngle ? 'Unique angle: ' + intel.dominanceAngle : ''}

CAROUSEL RULES:
• Slide 1 (hook): must stop the scroll — bold claim or numbered promise — max 8 words
• Slides 2-5: each teaches ONE specific insight — headline max 7 words, body max 25 words but make every word count
• Slide 6 (CTA): clear action tied directly to the content — not generic "follow for more"
• The 4 middle slides must flow as a complete framework or story arc
• Caption: full-depth — hook line + 3-4 paragraphs of value + CTA (not 2 sentences)
• 30 hashtags — 10 large, 10 medium, 10 niche-specific

Return exactly:
{
  "hook": "slide 1 viral headline",
  "hookAccentWord": "one word to highlight",
  "hookIcon": "relevant emoji",
  "slides": [
    { "headline": "...", "body": "...", "accentWord": "...", "icon": "emoji" },
    { "headline": "...", "body": "...", "accentWord": "...", "icon": "emoji" },
    { "headline": "...", "body": "...", "accentWord": "...", "icon": "emoji" },
    { "headline": "...", "body": "...", "accentWord": "...", "icon": "emoji" }
  ],
  "cta": "final slide CTA",
  "ctaAccentWord": "one word to highlight",
  "caption_hook": "opening caption line — makes them swipe",
  "caption_body": "3-4 paragraphs of real value — teach something from the carousel, connect to audience pain, bridge to transformation",
  "caption_cta": "specific CTA — comment keyword or link in bio",
  "hashtags": ["tag1","tag2",...30 total, no # symbols],
  "scriptAccent": "short inspirational phrase in script style max 6 words"
}`,
    1800
  );
  const data = extractJSON(text) || {};
  const captionFull = [data.caption_hook, data.caption_body, data.caption_cta].filter(Boolean).join('\n\n');
  const hashtagsStr = (data.hashtags || []).map(t => '#' + t.replace(/^#/, '')).join(' ');
  return {
    type:          'Carousel',
    slideData:     data,
    hook:          data.hook    || '',
    caption:       captionFull,
    hashtags:      hashtagsStr,
    status:        'ready',
    scheduledTime: withTz('12:00pm'),
  };
}

// ── Caption + Hashtags (for FB posts — caption is for sharing context) ──
async function genCaptionAndHashtags(intel, pillar) {
  const text = await ai(
    'You are a social media copywriter. Return ONLY valid JSON — no markdown, no fences.',
    `Write a Facebook post share caption and 30 hashtags for a post about "${pillar}" in ${intel.niche}.

The caption should be 2-3 sentences that tease the post content and make people want to read or share it.
Hashtags: exactly 30 strings, no # symbols — 10 large (1M+ posts), 10 medium (100K-1M), 10 niche-specific.

Return: { "caption": "...", "hashtags": ["tag1","tag2",...] }`,
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

  const totalDays  = job.duration      || 30;
  const types      = job.contentTypes  || {};
  const cloneIds   = job.cloneIds      || [];
  const rotation   = job.rotationStyle || 'sequential';
  const isAffiliate= !!job.isAffiliate;
  // Timezone — passed from the app, defaults to UTC if not provided
  const userTz     = job.timezone      || 'UTC';

  // Helper: append timezone abbreviation to a time string
  function withTz(timeStr) {
    if (!timeStr) return timeStr;
    // Get short abbreviation using Intl if timezone is valid
    try {
      const parts = Intl.DateTimeFormat('en-US', {
        timeZone: userTz, timeZoneName: 'short'
      }).formatToParts(new Date());
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      const abbr   = tzPart ? tzPart.value : userTz;
      return timeStr + ' ' + abbr;
    } catch(e) {
      return timeStr + ' ' + userTz;
    }
  }

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
