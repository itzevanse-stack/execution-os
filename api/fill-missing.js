// api/fill-missing.js — Fill missing content types for existing calendar days
// POST { uid, missingType, dayNumbers[], isAffiliate }

'use strict';

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');
const Anthropic                         = require('@anthropic-ai/sdk');

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

// Real-performance context (the feedback loop) — set per-request in the
// handler; ensures content cites the user's REAL numbers or none at all.
let REQUEST_REAL_DATA = '';
function buildRealDataBlock(p) {
  if (!p || !p.hasAnyData) {
    return '\n\nREAL PERFORMANCE DATA: none tracked yet for this user. Do not state any performance numbers as fact.';
  }
  let out = '\n\nREAL PERFORMANCE DATA — this user\'s ACTUAL tracked results (last 30 days). These are the ONLY performance numbers you may cite:';
  out += '\n- Sales: ' + p.sales.count + ' (' + p.sales.currency + ' ' + p.sales.revenue + ' revenue)';
  out += '\n- Leads captured: ' + p.leads.count + (p.leads.topSource ? ' (best source: ' + p.leads.topSource + ')' : '');
  if (p.email && p.email.sent) out += '\n- Email: ' + p.email.sent + ' sent' + (p.email.openRate ? ', ' + p.email.openRate + ' open rate' : '');
  out += '\n- Content published: ' + (p.content ? p.content.published : 0) + ' pieces';
  return out;
}

async function ai(system, user, maxTokens) {
  const r = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: maxTokens || 1000,
    system:     (system || '') + REQUEST_REAL_DATA,
    messages: [{ role: 'user', content: user }],
  });
  return (r.content[0] && r.content[0].text) || '';
}

function extractJSON(text) {
  try {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(text.slice(s, e+1));
  } catch(e) {}
  return null;
}

function withTz(t) { return t; }

// ── Pull intelligence from Firestore ─────────────────────────────
async function loadIntelligence(uid, isAffiliate) {
  const db   = getDb();
  const snap = await db.collection('users').doc(uid).get();
  const d    = snap.exists ? snap.data() : {};
  const defaults = {
    niche: 'Online Business', offerName: 'My Offer', price: 997,
    pain: 'struggling to make consistent income online',
    transformation: 'financial freedom and time freedom',
    pillars: ['Mindset','Strategy','Content','Sales','Systems'],
    hooks: ['Here is what nobody tells you about making money online'],
    fear: '', tried: '', deeperPain: '', identity: '', dominanceAngle: '', voiceNotes: '',
  };
  if (isAffiliate) {
    const ao   = d.affiliateOffer || {};
    const affCE= ao.contentEngine  || {};
    const vp   = d.voiceProfile    || {};
    return {
      niche:          ao.niche           || defaults.niche,
      offerName:      ao.name            || defaults.offerName,
      price:          ao.commission      || defaults.price,
      pain:           ao.pain            || defaults.pain,
      deeperPain:     ao.deeperPain      || '',
      fear:           ao.fear            || '',
      tried:          ao.tried           || '',
      transformation: ao.transformation  || defaults.transformation,
      identity:       ao.identity        || '',
      pillars:        Array.isArray(affCE.pillars) ? affCE.pillars : defaults.pillars,
      hooks:          Array.isArray(affCE.hooks)   ? affCE.hooks   : defaults.hooks,
      dominanceAngle: ao.dominanceAngle  || '',
      voiceNotes:     vp.notes || (vp.tone ? 'Tone: ' + vp.tone : ''),
    };
  }
  const bi  = d.boardroomIntel  || {};
  const ce  = bi.contentEngine  || {};
  const cv  = bi.copyVault      || {};
  const av  = d.avatarData      || {};
  const inp = bi.inputs         || {};
  const ar  = bi.architect      || {};
  const vp  = d.voiceProfile    || {};
  return {
    niche:          inp.niche           || defaults.niche,
    offerName:      inp.offerName       || defaults.offerName,
    price:          inp.price           || defaults.price,
    pain:           av.pain             || inp.av_pain || defaults.pain,
    deeperPain:     av.deeperPain       || '',
    fear:           av.fear             || '',
    tried:          av.tried            || '',
    transformation: av.transformation   || defaults.transformation,
    identity:       av.identity         || '',
    pillars:        Array.isArray(ce.pillars) ? ce.pillars : defaults.pillars,
    hooks:          Array.isArray(cv.hooks)   ? cv.hooks   : defaults.hooks,
    dominanceAngle: ar.dominanceAngle   || '',
    voiceNotes:     vp.notes || (vp.tone ? 'Tone: ' + vp.tone : ''),
  };
}

function getPillarForDay(day, pillars) {
  return (pillars && pillars.length) ? pillars[(day - 1) % pillars.length] : 'Value & Strategy';
}
function getHookForDay(day, hooks) {
  return (hooks && hooks.length) ? hooks[(day - 1) % hooks.length] : '';
}

// ── Generators (stripped-down versions) ──────────────────────────
async function genCarousel(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Instagram carousel copywriter for ${intel.niche}. Return ONLY valid JSON — no markdown, no fences.`,
    `Write a 6-slide Instagram carousel for Day ${day}.
Content pillar: ${pillar}
Hook angle: ${hook}
Offer: ${intel.offerName}
Audience pain: ${intel.pain}
${intel.deeperPain ? 'Deeper pain: ' + intel.deeperPain : ''}
${intel.dominanceAngle ? 'Positioning: ' + intel.dominanceAngle : ''}

Return: {
  "hook": "viral slide 1 headline max 8 words",
  "slides": [{"headline":"...","body":"..."},{"headline":"...","body":"..."},{"headline":"...","body":"..."},{"headline":"...","body":"..."}],
  "cta": "final slide CTA",
  "caption_hook": "opening caption line",
  "caption_body": "3-4 paragraphs of real value",
  "caption_cta": "caption CTA",
  "hashtags": ["tag1","tag2"]
}
slides: exactly 4 items. hashtags: 30 strings, no # symbols.`,
    1200
  );
  const data = extractJSON(text) || {};
  const captionFull = [data.caption_hook, data.caption_body, data.caption_cta].filter(Boolean).join('\n\n');
  const hashtagsStr = (data.hashtags || []).map(t => '#' + t.replace(/^#/, '')).join(' ');
  return { type:'Carousel', slideData:data, hook:data.hook||'', caption:captionFull, hashtags:hashtagsStr, status:'ready', scheduledTime:withTz('12:00pm') };
}

async function genFBPost1(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Facebook copywriter for ${intel.niche}. Return only the post text.${intel.voiceNotes ? '\nVOICE: ' + intel.voiceNotes : ''}`,
    `Write a Facebook post for Day ${day}. Pillar: ${pillar}. Hook: ${hook}. Pain: ${intel.pain}. Offer: ${intel.offerName}. 300-500 words. End with comment CTA.`,
    800
  );
  return { type:'FB Post 1', content:text, status:'ready', scheduledTime:withTz('6:00am') };
}

async function genFBPost2(intel, pillar, hook, day) {
  const text = await ai(
    `You are an elite Facebook copywriter for ${intel.niche}. Return only the post text.`,
    `Write a story-based Facebook post for Day ${day}. Pillar: ${pillar}. Pain: ${intel.pain}. Transformation: ${intel.transformation}. Offer: ${intel.offerName}. 200-350 words. End with DM CTA.`,
    600
  );
  return { type:'FB Post 2', content:text, status:'ready', scheduledTime:withTz('3:00pm') };
}

async function genEmail(intel, pillar, day) {
  const text = await ai(
    `You are an email copywriter for ${intel.niche}. Return ONLY valid JSON.`,
    `Write a marketing email for Day ${day}. Pillar: ${pillar}. Offer: ${intel.offerName}. Transformation: ${intel.transformation}. Return: { "subject": "...", "preheader": "...", "body": "..." }`,
    700
  );
  const data = extractJSON(text) || {};
  return { type:'Email', subject:data.subject||pillar, preheader:data.preheader||'', content:data.body||text, status:'ready', scheduledTime:withTz('8:00pm') };
}

async function genReelScript(intel, pillar, hook, day, reelNum) {
  const text = await ai(
    `You are a short-form video scriptwriter for ${intel.niche}. Each sentence on its own line. No stage directions.`,
    `Write a 90-second Reel script for Day ${day}, Reel ${reelNum}. Hook: ${hook}. Pillar: ${pillar}. Pain: ${intel.pain}. Offer: ${intel.offerName}. 170-200 words.`,
    500
  );
  return { type:`Reel ${reelNum}`, script:text, status:'ready', scheduledTime:withTz(reelNum===1?'9:00am':'6:00pm') };
}

// ═════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { uid, missingType, dayNumbers, isAffiliate, performance } = req.body || {};
  REQUEST_REAL_DATA = buildRealDataBlock(performance);
  if (!uid || !missingType || !Array.isArray(dayNumbers) || !dayNumbers.length) {
    return res.status(400).json({ error: 'uid, missingType, dayNumbers[] required' });
  }

  const db      = getDb();
  const intel   = await loadIntelligence(uid, !!isAffiliate);
  const results = [];

  for (const dayNumber of dayNumbers.slice(0, 30)) {
    try {
      const pillar = getPillarForDay(dayNumber, intel.pillars);
      const hook   = getHookForDay(dayNumber, intel.hooks);
      let piece    = null;

      if (missingType === 'carousel') piece = await genCarousel(intel, pillar, hook, dayNumber);
      if (missingType === 'fb1')      piece = await genFBPost1(intel, pillar, hook, dayNumber);
      if (missingType === 'fb2')      piece = await genFBPost2(intel, pillar, hook, dayNumber);
      if (missingType === 'email')    piece = await genEmail(intel, pillar, dayNumber);
      if (missingType === 'reel1')    piece = await genReelScript(intel, pillar, hook, dayNumber, 1);
      if (missingType === 'reel2')    piece = await genReelScript(intel, pillar, hook, dayNumber, 2);

      if (piece) {
        const dayRef = db.collection('calendar').doc(uid).collection('days').doc('day' + dayNumber);
        await dayRef.set({ [missingType]: piece }, { merge: true });
        results.push({ dayNumber, ok: true });
      }
    } catch(e) {
      console.warn(`[fill-missing] Day ${dayNumber} ${missingType} failed:`, e.message);
      results.push({ dayNumber, ok: false, error: e.message });
    }
  }

  return res.status(200).json({ ok: true, filled: results.filter(r=>r.ok).length, results });
};
