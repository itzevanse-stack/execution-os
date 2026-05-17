// api/boardroom.js — LangGraph Boardroom Agent
// Node.js 20 · CommonJS · Vercel serverless (maxDuration: 300)
//
// Graph: collect_state → validate_inputs → research_niche → build_positioning
//        → [offer_stack + copy_vault + war_plan] (parallel) → content_engine
//        → validate_output → END
//
// LangSmith traces every run automatically when LANGCHAIN_API_KEY is set.

const Anthropic = require('@anthropic-ai/sdk');

// ── LangSmith tracing — uses official SDK when LANGCHAIN_API_KEY is set ─────
if (process.env.LANGCHAIN_API_KEY) {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_PROJECT    = process.env.LANGCHAIN_PROJECT || 'execution-os-boardroom';
}

// Wrap a function with LangSmith tracing
function traced(name, fn) {
  try {
    const { traceable } = require('langsmith/traceable');
    return traceable(fn, { name, project_name: process.env.LANGCHAIN_PROJECT || 'execution-os-boardroom' });
  } catch(e) {
    // langsmith not installed or not configured — run without tracing
    return fn;
  }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Model configuration ───────────────────────────────────────────────────────
const MODEL   = 'claude-sonnet-4-20250514';
const FAST    = 'claude-haiku-4-5-20251001';   // used for quick validation checks

// ── Lightweight run tracker (timing + token counts for response) ─────────────
class RunTracer {
  constructor(name, tags) {
    this.name    = name;
    this.tags    = tags || [];
    this.runId   = 'br-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
    this.spans   = [];
    this.startMs = Date.now();
  }
  span(name) {
    const span = { name, startMs: Date.now(), endMs: null, tokens: 0, error: null };
    this.spans.push(span);
    return {
      end:   (tokens)  => { span.endMs = Date.now(); span.tokens = tokens || 0; },
      error: (message) => { span.endMs = Date.now(); span.error  = message; },
    };
  }
  summary() {
    const totalMs     = Date.now() - this.startMs;
    const totalTokens = this.spans.reduce((s, sp) => s + sp.tokens, 0);
    const failed      = this.spans.filter(sp => sp.error).map(sp => sp.name);
    return { runId: this.runId, totalMs, totalTokens, failed, spans: this.spans.length };
  }
  async postToLangSmith(state) {
    if (!process.env.LANGCHAIN_API_KEY) return;
    try {
      await fetch('https://api.smith.langchain.com/runs', {
        method:  'POST',
        headers: { 'x-api-key': process.env.LANGCHAIN_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:         this.runId,
          name:       this.name,
          run_type:   'chain',
          inputs:     { niche: state.niche, price: state.price, target: state.target },
          outputs:    { tabs: ['architect','offerStack','copyVault','warPlan','contentEngine'].filter(k => state[k] && Object.keys(state[k]).length > 0) },
          start_time: new Date(this.startMs).toISOString(),
          end_time:   new Date().toISOString(),
          extra:      { metadata: { tags: this.tags, totalTokens: this.spans.reduce((s,sp) => s+sp.tokens, 0) } },
        }),
      });
      console.log('[LangSmith] Run posted:', this.runId);
    } catch(e) {
      console.warn('[LangSmith] Post failed:', e.message);
    }
  }
}

// ── Core AI call ──────────────────────────────────────────────────────────────
async function ai(systemPrompt, userPrompt, maxTokens, model) {
  const msg = await client.messages.create({
    model:      model || MODEL,
    max_tokens: maxTokens || 2000,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  const text  = msg.content?.[0]?.text || '';
  const usage = (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0);
  return { text, tokens: usage };
}

// ── JSON extractor — strips markdown fences, finds first { } ─────────────────
function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s     = clean.indexOf('{');
  const e     = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); }
  catch(err) {
    // Try to fix common truncation: missing closing braces
    let attempt = clean.slice(s);
    const opens  = (attempt.match(/\{/g) || []).length;
    const closes = (attempt.match(/\}/g) || []).length;
    attempt += '}'.repeat(Math.max(0, opens - closes));
    try { return JSON.parse(attempt); } catch { return null; }
  }
}

// ── Web search (Tavily) — used in research_niche ──────────────────────────────
async function webSearch(query, maxResults) {
  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  if (!TAVILY_KEY) return [];
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:      TAVILY_KEY,
        query:        query,
        max_results:  maxResults || 5,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    return (data.results || []).map(r => r.content || r.snippet || '').filter(Boolean);
  } catch(e) {
    console.warn('[Boardroom] Web search failed:', e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GRAPH NODES
// ══════════════════════════════════════════════════════════════════════════════

// ── Node 1: collect_state ─────────────────────────────────────────────────────
// Normalise and enrich the inputs before any AI work
function node_collect_state(state) {
  return {
    ...state,
    clientsNeeded: Math.ceil((state.target || 25000) / (state.price || 3000)),
    leadsNeeded:   Math.ceil((state.target || 25000) / (state.price || 3000) / 0.25),
    noMoney:       !state.allowMoney,
    collected:     true,
  };
}

// ── Node 2: validate_inputs ───────────────────────────────────────────────────
// Score completeness. Route to END_INCOMPLETE if too thin.
async function node_validate_inputs(state, tracer) {
  const span = tracer.span('validate_inputs');
  const fields = [
    state.niche, state.offerName, state.av_pain, state.av_job,
    state.promise || state.result, state.price, state.target,
  ];
  const filled = fields.filter(f => f && String(f).trim().length > 2).length;
  const score  = Math.round((filled / fields.length) * 100);

  let missing = [];
  if (!state.av_pain)               missing.push('avatar pain');
  if (!state.av_job)                missing.push('avatar job/role');
  if (!state.promise && !state.result) missing.push('offer promise or result');
  if (!state.offerName)             missing.push('offer name');

  span.end(0);
  return { ...state, inputScore: score, missingFields: missing, validationDone: true };
}

// ── Node 3: research_niche ────────────────────────────────────────────────────
// Web search for real market language — the node that changes everything
const node_research_niche = traced('research_niche', async function(state, tracer) {
  const span  = tracer.span('research_niche');
  const niche = state.niche || 'Online Business';
  const pain  = state.av_pain || 'their main struggle';
  const job   = state.av_job  || 'professional';

  // Run 3 targeted searches in parallel
  const [painResults, successResults, competitorResults] = await Promise.all([
    webSearch(`"${niche}" "${pain}" reddit site:reddit.com OR site:quora.com`, 4),
    webSearch(`"${niche}" success story transformation result achieved`, 3),
    webSearch(`"${niche}" coaching programme offer "$${state.price || 3000}"`, 3),
  ]);

  const allResults = [...painResults, ...successResults, ...competitorResults]
    .join('\n')
    .slice(0, 3000);  // cap at 3000 chars to keep prompts lean

  // If Tavily isn't configured, generate synthetic market intelligence from the LLM
  let marketIntel = allResults;
  if (!allResults || allResults.length < 100) {
    const synth = await ai(
      'You are a market researcher. Generate realistic, specific market intelligence based on deep niche knowledge.',
      `Generate realistic market research for: ${niche}
Avatar: ${job} experiencing "${pain}"
Price point: $${state.price || 3000}

Return 5-7 bullet points of:
- Real phrases buyers use when describing their pain
- What they've already tried that failed
- What success looks like to them
- What they're skeptical about
- What makes them finally decide to buy

Be specific and use the language real people in this niche use.`,
      800
    );
    marketIntel = synth.text;
    span.end(synth.tokens);
  } else {
    span.end(0);
  }

  return { ...state, marketIntel, researchDone: true };
});

// ── Node 4: build_positioning ─────────────────────────────────────────────────
// Builds the strategic foundation everything else reads from
const node_build_positioning = traced('build_positioning', async function(state, tracer) {
  const span = tracer.span('build_positioning');

  const { text, tokens } = await ai(
    `You are a $100M business architect. You have built multiple 7-figure expert businesses from scratch. You give advice so specific it could only apply to this exact person — their exact niche, avatar, and market position. Every word you write earns its place.`,

    `Build the strategic foundation for this expert business. Return ONLY valid JSON.

NICHE: ${state.niche}
OFFER: ${state.offerName || 'Unnamed'} at $${state.price}
TARGET: $${state.target}/month (needs ${state.clientsNeeded} clients at 25% close = ${state.leadsNeeded} leads/month)
AVATAR: ${state.av_job} — Pain: "${state.av_pain}" — Fear: "${state.av_fear || 'not specified'}" — Tried: "${state.av_tried || 'not specified'}"
TRANSFORMATION: ${state.av_desire || state.nicheTransform || 'not specified'}
UNIQUE ANGLE: ${state.difference || 'not specified'}
MARKET RESEARCH: ${(state.marketIntel || '').slice(0, 800)}
${state.noMoney ? `NICHE RULE: ${state.niche} — zero income/money language. Focus entirely on transformation and life outcomes.` : ''}

Return this JSON (every field must be devastatingly specific to THIS person, not generic):
{
  "positioningStatement": "One sentence: who you serve + what you do + why you are the only logical choice. Must name their exact pain and outcome.",
  "categoryName": "The new category you CREATE and own — not coaching, not consulting. A new word or phrase that only you own.",
  "dominanceAngle": "The single angle that makes this offer categorically different — not just better, not just cheaper, but a completely different thing.",
  "competitiveMoat": "Three specific, real, hard-to-copy advantages this person has. Reference their actual background and experience.",
  "revenueBreakdown": {
    "clientsPerMonth": ${state.clientsNeeded},
    "closingRate": "25%",
    "leadsPerMonth": ${state.leadsNeeded},
    "dailyLeadActions": "3 specific daily actions to generate ${Math.ceil(state.leadsNeeded / 20)} leads/day in ${state.niche}",
    "weeklyMilestone": "What a successful week looks like — specific numbers and activities",
    "firstClientAction": "The single most important action to take in the next 24 hours to get the next client"
  },
  "top3Mistakes": [
    "The #1 specific mistake ${state.niche} experts make that keeps them under $10K/month",
    "The #2 pricing or positioning mistake — why they undercharge",
    "The #3 sales conversation mistake that kills deals before they start"
  ],
  "unfairAdvantage": "What this specific person has that competitors will never have — specific about experience, access, or insight",
  "immediateWin": "The ONE action in the next 24 hours tied to getting the very next client"
}`,
    2500
  );

  const positioning = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, positioning, positioningDone: true };
});

// ── Node 5a: build_offer_stack ────────────────────────────────────────────────
const node_build_offer_stack = traced('build_offer_stack', async function(state, tracer) {
  const span = tracer.span('build_offer_stack');
  const pos  = state.positioning || {};

  const { text, tokens } = await ai(
    `You are the offer architect behind hundreds of $10K–$100K offers. You have studied Hormozi, Kern, and every major offer structure that has generated millions. An offer is a promise, a vehicle, and a transformation packaged for a specific buyer at a specific moment of pain. You build offers so compelling that the right buyer feels stupid saying no.`,

    `Rebuild this offer to command $${state.price}+ with zero resistance. Return ONLY valid JSON.

OFFER: ${state.offerName || 'Unnamed'} | NICHE: ${state.niche}
PROMISE: ${state.promise || state.result || 'not specified'}
DURATION: ${state.duration || 'not specified'} | FORMAT: ${state.format || 'not specified'}
AVATAR PAIN: "${state.av_pain}" | FEAR: "${state.av_fear || 'not specified'}"
POSITIONING: ${pos.positioningStatement || 'not built yet'}
CATEGORY: ${pos.categoryName || 'not built yet'}
${state.noMoney ? `NICHE RULE: Zero income/money language. Transformation only.` : ''}

{
  "rebuiltName": "Premium, specific, result-focused offer name that names the exact transformation",
  "framework": {
    "name": "Your proprietary framework name — must sound like something only YOU created",
    "steps": ["Step 1 — specific action", "Step 2 — specific action", "Step 3 — specific action"]
  },
  "coreTransformation": "The exact before-to-after journey — devastatingly specific. What does life look like before? What does it look like after?",
  "valueStack": [
    { "item": "Core programme delivery", "value": "$${state.price * 3}", "why": "Why this alone is worth 3x the price" },
    { "item": "Weekly 1-on-1 strategy sessions", "value": "$${state.price * 2}", "why": "The value of direct access to the expert" },
    { "item": "Proprietary framework and playbook", "value": "$${Math.round(state.price * 1.5)}", "why": "Years of trial and error compressed" },
    { "item": "Done-with-you implementation support", "value": "$${state.price}", "why": "No more figuring it out alone" },
    { "item": "Fast-action bonus — specific and compelling", "value": "$${Math.round(state.price * 0.8)}", "why": "Why acting now is the smart move" }
  ],
  "totalValue": "$${state.price * 8}",
  "guarantee": "A guarantee so strong it removes all risk. Must be outcome-specific, not just a refund.",
  "pricingJustification": "2-3 sentences: why $${state.price} is not expensive — it's the cheapest path to the outcome they want"
}`,
    2000
  );

  const offerStack = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, offerStack };
});

// ── Node 5b: build_copy_vault ─────────────────────────────────────────────────
const node_build_copy_vault = traced('build_copy_vault', async function(state, tracer) {
  const span    = tracer.span('build_copy_vault');
  const pos     = state.positioning || {};
  const market  = (state.marketIntel || '').slice(0, 400);

  const { text, tokens } = await ai(
    `You are the best direct-response copywriter alive. You have written copy that has generated over $100M for expert businesses. You write REAL finished copy that sounds like a trusted human — never AI. Your copy is specific, personal, and impossible to ignore. Every line earns its place.`,

    `Write the complete Copy Vault for this offer. Return ONLY valid JSON. Every string must be REAL, FINISHED, READY-TO-USE copy — not descriptions of what to write.

NICHE: ${state.niche} | OFFER: ${state.offerName}
RESULT: ${state.result || state.promise}
AVATAR: ${state.av_job} | PAIN: "${state.av_pain}" | FEAR: "${state.av_fear || ''}" | TRIED: "${state.av_tried || ''}"
POSITIONING: ${pos.positioningStatement || ''}
MARKET LANGUAGE: ${market}
${state.noMoney ? `RULE: Zero income/money language. This is ${state.niche}.` : ''}

{
  "headlines": [
    "Headline 1 — outcome-focused, uses their exact pain language",
    "Headline 2 — different emotional angle",
    "Headline 3 — names what they've tried and failed",
    "Headline 4 — names the transformation specifically",
    "Headline 5 — bold, specific, category-creating"
  ],
  "hooks": [
    "Hook 1 — pattern interrupt: first 3 seconds stops the scroll completely",
    "Hook 2 — curiosity: makes them desperate to know the answer",
    "Hook 3 — bold claim: specific and provable, not vague",
    "Hook 4 — story: a personal moment they instantly recognise",
    "Hook 5 — question: they answer yes before they know why"
  ],
  "dmOpeners": [
    "DM after they comment — personal, warm, not salesy",
    "DM after they follow — starts a conversation, not a pitch",
    "Cold DM — feels warm because it references something specific they posted",
    "DM from referral — natural mention of the mutual connection",
    "DM event-based — references something they just shared or announced"
  ],
  "emailSubjects": [
    "Subject 1 — feels like a text from a friend",
    "Subject 2 — curiosity gap that must be opened",
    "Subject 3 — specific benefit in plain language",
    "Subject 4 — pattern interrupt that stops the delete reflex",
    "Subject 5 — story opener that pulls them in"
  ],
  "vslScript": "90-second VSL opener written as natural spoken words. HOOK (10 sec): [stop-the-scroll opener]. PROBLEM (30 sec): [agitate the pain they feel every day]. PROMISE (20 sec): [the big outcome]. PROOF TEASER (20 sec): [one specific result]. CTA (10 sec): [what to do right now]. Write it as if speaking directly to camera — conversational, honest, specific.",
  "salesBullets": [
    "Bullet 1 — specific outcome with a timeframe",
    "Bullet 2 — eliminates their biggest fear directly",
    "Bullet 3 — addresses what they tried before and why this is different",
    "Bullet 4 — the social proof angle in one line",
    "Bullet 5 — the transformation described so specifically it feels personal",
    "Bullet 6 — the guarantee framed as a commitment not a safety net"
  ],
  "objections": {
    "price": "Handle: the price is too high — reframe the investment vs the cost of staying stuck",
    "time": "Handle: I don't have time — address the real fear underneath that",
    "trust": "Handle: I'm not sure this will work for me — make them feel seen and heard",
    "timing": "Handle: it's not the right time — this is the most common stall and the most winnable"
  }
}`,
    3500
  );

  const copyVault = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, copyVault };
});

// ── Node 5c: build_war_plan ───────────────────────────────────────────────────
const node_build_war_plan = traced('build_war_plan', async function(state, tracer) {
  const span = tracer.span('build_war_plan');

  const { text, tokens } = await ai(
    `You are the launch strategist behind the fastest go-to-markets in the expert business world. You think in sequences, triggers, and conversion events. You give actions so specific they can be executed today without extra thinking. No vague instructions — specific platforms, specific messages, specific targets, specific numbers.`,

    `Build a 30-day launch war plan. Return ONLY valid JSON. Every action must be specific enough to execute today.

NICHE: ${state.niche} | OFFER: ${state.offerName} at $${state.price}
TARGET: $${state.target}/month (${state.clientsNeeded} clients, ${state.leadsNeeded} leads needed)
AVATAR: ${state.av_job} struggling with "${state.av_pain}"
PLATFORM SIGNALS: ${state.av_keywords || 'not specified'}

{
  "phase1": {
    "title": "Foundation (Days 1–7)",
    "goal": "Specific goal for this phase — what must be built or proved",
    "days": [
      { "day": 1, "focus": "specific day 1 task title", "actions": ["specific action 1 for ${state.niche}", "specific action 2", "specific action 3"] },
      { "day": 2, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 3, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 4, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 5, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 6, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 7, "focus": "title", "actions": ["action 1", "action 2", "action 3"] }
    ]
  },
  "phase2": {
    "title": "Momentum (Days 8–14)",
    "goal": "Specific momentum goal — first proof of concept",
    "days": [
      { "day": 8,  "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 9,  "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 10, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 11, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 12, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 13, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 14, "focus": "title", "actions": ["action 1", "action 2", "action 3"] }
    ]
  },
  "phase3": {
    "title": "Launch (Days 15–21)",
    "goal": "First paying clients — specific target",
    "days": [
      { "day": 15, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 16, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 17, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 18, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 19, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 20, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 21, "focus": "title", "actions": ["action 1", "action 2", "action 3"] }
    ]
  },
  "phase4": {
    "title": "Scale (Days 22–30)",
    "goal": "Systematise what worked — specific scale target",
    "days": [
      { "day": 22, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 25, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 28, "focus": "title", "actions": ["action 1", "action 2", "action 3"] },
      { "day": 30, "focus": "title", "actions": ["action 1", "action 2", "action 3"] }
    ]
  },
  "metrics": [
    "KPI 1 specific to ${state.niche} — what to measure weekly",
    "KPI 2 — conversion metric to track",
    "KPI 3 — leading indicator of $${state.target}/month"
  ],
  "criticalWarning": "The single most common reason ${state.niche} launches fail — brutally honest and specific to this situation"
}`,
    5000
  );

  const warPlan = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, warPlan };
});

// ── Node 6: content_engine ────────────────────────────────────────────────────
const node_content_engine = traced('content_engine', async function(state, tracer) {
  const span  = tracer.span('content_engine');
  const cv    = state.copyVault || {};
  const hooks = cv.hooks ? cv.hooks.slice(0, 2).join(' | ') : '';

  const { text, tokens } = await ai(
    `You are the content strategist behind the fastest-growing expert businesses in the world. Every post you write has one job: move a cold stranger into a booked call or closed sale. You write content so specific to the reader's pain that they feel like you've been watching their life. REAL, FINISHED, HUMAN-SOUNDING content — never AI-sounding filler.`,

    `Build 7 days of conversion content. Return ONLY valid JSON. Every field must contain REAL, FINISHED content.

NICHE: ${state.niche} | OFFER: ${state.offerName}
AVATAR: ${state.av_job} | PAIN: "${state.av_pain}" | DESIRE: "${state.av_desire || state.nicheTransform || ''}"
POSITIONING: ${(state.positioning || {}).positioningStatement || ''}
HOOKS TO USE: ${hooks}
${state.noMoney ? `RULE: Zero income/money language. This is ${state.niche}.` : ''}

Strategy: Day 1-2 educate about the problem. Day 3-4 introduce the solution naturally. Day 5-6 proof and objections. Day 7 clear CTA.

{
  "pillars": [
    "Pillar 1 — content theme specific to ${state.niche}",
    "Pillar 2 — content theme",
    "Pillar 3 — content theme",
    "Pillar 4 — content theme",
    "Pillar 5 — content theme"
  ],
  "conversionStrategy": "2 sentences: how this 7-day sequence moves someone from cold to booked call",
  "days": [
    {
      "day": 1,
      "theme": "Problem awareness — no selling",
      "fbPost": "Complete 120-word Facebook post. First sentence stops scroll. Short paragraphs. Ends with a genuine question. Sounds like a real person, not AI.",
      "reelScript": "HOOK: [3-second opener that stops scroll] | CONTENT: [Point 1. Point 2. Point 3. Natural spoken language.] | CTA: [5-second call to action]",
      "emailSubject": "Subject line that feels like a text from a friend",
      "emailBody": "Complete 100-word email written to ONE specific person. Honest and direct. Ends with a single clear action."
    },
    { "day": 2, "theme": "deepen problem", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },
    { "day": 3, "theme": "solution introduction", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },
    { "day": 4, "theme": "the mechanism", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },
    { "day": 5, "theme": "proof and results", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },
    { "day": 6, "theme": "objection handling", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },
    { "day": 7, "theme": "clear call to action", "fbPost": "complete post", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" }
  ]
}`,
    5000
  );

  const content = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, content };
});

// ── Node 7: validate_output ───────────────────────────────────────────────────
// Scores each tab, flags empties for frontend to show retry buttons
function node_validate_output(state) {
  const tabs = {
    architect:     state.positioning,
    offerStack:    state.offerStack,
    copyVault:     state.copyVault,
    warPlan:       state.warPlan,
    contentEngine: state.content,
  };

  const scores  = {};
  const empties = [];

  for (const [name, data] of Object.entries(tabs)) {
    const keys = Object.keys(data || {}).filter(k => {
      const v = data[k];
      return v && (typeof v === 'string' ? v.length > 10 : Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v).length > 0 : false);
    });
    scores[name] = Math.round((keys.length / Math.max(1, Object.keys(data || {}).length)) * 100);
    if (scores[name] < 30 || !data || Object.keys(data).length === 0) {
      empties.push(name);
    }
  }

  return { ...state, tabScores: scores, emptyTabs: empties, validated: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// GRAPH EXECUTOR
// ══════════════════════════════════════════════════════════════════════════════

async function runBoardroomGraph(inputs, tracer, onProgress) {
  let state = { ...inputs };

  const progress = (step, message) => {
    if (onProgress) onProgress({ step, message });
    console.log(`[Boardroom] ${step}: ${message}`);
  };

  // Node 1
  progress('collect_state', 'Reading your business inputs');
  state = node_collect_state(state);

  // Node 2
  progress('validate_inputs', 'Checking completeness of your profile');
  state = await node_validate_inputs(state, tracer);

  if (state.missingFields && state.missingFields.length > 2) {
    return {
      ...state,
      incomplete:    true,
      error:         `Please complete: ${state.missingFields.join(', ')} before running The Boardroom.`,
    };
  }

  // Node 3
  progress('research_niche', `Researching ${state.niche} market intelligence`);
  state = await node_research_niche(state, tracer);

  // Node 4
  progress('build_positioning', 'Building your market positioning');
  state = await node_build_positioning(state, tracer);

  // Nodes 5a, 5b, 5c — parallel
  progress('parallel_build', 'Building offer stack, copy vault, and war plan in parallel');
  const [afterOffer, afterCopy, afterWar] = await Promise.all([
    node_build_offer_stack(state, tracer),
    node_build_copy_vault(state, tracer),
    node_build_war_plan(state, tracer),
  ]);
  // Merge parallel results into state
  state = { ...state, offerStack: afterOffer.offerStack, copyVault: afterCopy.copyVault, warPlan: afterWar.warPlan };

  // Node 6
  progress('content_engine', 'Engineering your content system');
  state = await node_content_engine(state, tracer);

  // Node 7
  progress('validate_output', 'Validating all outputs');
  state = node_validate_output(state);

  return state;
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ══════════════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { inputs, tab } = req.body || {};
  if (!inputs) return res.status(400).json({ error: 'Missing inputs' });

  const tracer = new RunTracer('boardroom-run', [inputs.niche, `$${inputs.price}`]);

  // ── Single tab regeneration (from retry buttons) ──────────────────────────
  if (tab) {
    const tabNodeMap = {
      'architect':      node_build_positioning,
      'offer-stack':    node_build_offer_stack,
      'copy-vault':     node_build_copy_vault,
      'war-plan':       node_build_war_plan,
      'content-engine': node_content_engine,
    };
    const nodeFn = tabNodeMap[tab];
    if (!nodeFn) return res.status(400).json({ error: 'Unknown tab: ' + tab });

    try {
      // Build state from inputs + any existing intel passed from the frontend
      // This avoids re-running research/positioning on every tab regeneration
      const existingIntel = req.body.intel || {};
      let state = { ...inputs };
      state = node_collect_state(state);

      // Use existing intel if available — skip expensive upstream nodes
      if (existingIntel.positioning && Object.keys(existingIntel.positioning).length > 0) {
        state.positioning = existingIntel.positioning;
      }
      if (existingIntel.marketIntel) {
        state.marketIntel = existingIntel.marketIntel;
      }

      // Only run upstream nodes if we don't have their output already
      if (!state.marketIntel && (tab === 'architect' || tab === 'content-engine')) {
        state = await node_research_niche(state, tracer);
      }
      if (!state.positioning && (tab === 'copy-vault' || tab === 'offer-stack' || tab === 'war-plan' || tab === 'content-engine')) {
        state = await node_build_positioning(state, tracer);
      }

      const result = await nodeFn(state, tracer);
      const keyMap = {
        'architect':      'positioning',
        'offer-stack':    'offerStack',
        'copy-vault':     'copyVault',
        'war-plan':       'warPlan',
        'content-engine': 'content',
      };
      const outputKey = keyMap[tab];
      await tracer.postToLangSmith(result);
      return res.status(200).json({
        success:  true,
        tab,
        data:     result[outputKey] || {},
        tracer:   tracer.summary(),
      });
    } catch(err) {
      console.error('[Boardroom] Tab regen error:', err);
      return res.status(500).json({ error: err.message, tab });
    }
  }

  // ── Full graph run ────────────────────────────────────────────────────────
  try {
    const state = await runBoardroomGraph(inputs, tracer, null);
    await tracer.postToLangSmith(state);

    if (state.incomplete) {
      return res.status(400).json({ error: state.error, incomplete: true });
    }

    return res.status(200).json({
      success:        true,
      generatedAt:    Date.now(),
      inputs,
      architect:      state.positioning      || {},
      offerStack:     state.offerStack       || {},
      copyVault:      state.copyVault        || {},
      warPlan:        state.warPlan          || {},
      contentEngine:  state.content          || {},
      marketIntel:    state.marketIntel      || '',
      tabScores:      state.tabScores        || {},
      emptyTabs:      state.emptyTabs        || [],
      tracer:         tracer.summary(),
    });
  } catch(err) {
    console.error('[Boardroom] Graph error:', err);
    await tracer.postToLangSmith({ niche: inputs.niche, price: inputs.price });
    return res.status(500).json({ error: err.message, runId: tracer.runId });
  }
};
