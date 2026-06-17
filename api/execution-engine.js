// api/execution-engine.js — Execution-OS Execution Engine
// Single entry point for ALL AI operations.
// Loads user memory → routes to correct agent(s) → returns structured output.
// Powered by Tavily + LangSmith + Anthropic.
// maxDuration: 300 in vercel.json

const Anthropic = require('@anthropic-ai/sdk');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

// ── LangSmith ─────────────────────────────────────────────────────────────────
if (process.env.LANGCHAIN_API_KEY) {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_PROJECT    = process.env.LANGCHAIN_PROJECT || 'execution-os-boardroom';
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-6'; // was 'claude-sonnet-4-20250514' — retired, caused 404s on every call
const FAST   = 'claude-haiku-4-5-20251001';

// ── Firebase ──────────────────────────────────────────────────────────────────
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

// ── Run tracer ────────────────────────────────────────────────────────────────
class RunTracer {
  constructor(intent, uid) {
    this.intent  = intent;
    this.uid     = uid;
    this.runId   = 'ee-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    this.steps   = [];
    this.startMs = Date.now();
  }
  step(name, result) {
    this.steps.push({ name, ms: Date.now() - this.startMs, ok: !result?.error });
  }
  summary() {
    return { runId: this.runId, intent: this.intent, totalMs: Date.now() - this.startMs, steps: this.steps };
  }
  async post(output) {
    if (!process.env.LANGCHAIN_API_KEY) return;
    try {
      await fetch('https://api.smith.langchain.com/runs', {
        method: 'POST',
        headers: { 'x-api-key': process.env.LANGCHAIN_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.runId, name: 'execution-engine-' + this.intent, run_type: 'chain',
          inputs:  { intent: this.intent, uid: this.uid },
          outputs: { agents: this.steps.map(s => s.name), totalMs: Date.now() - this.startMs },
          start_time: new Date(this.startMs).toISOString(),
          end_time:   new Date().toISOString(),
          extra: { metadata: { steps: this.steps } },
        }),
      }).catch(() => {});
    } catch(e) {}
  }
}

// ── Core AI call ──────────────────────────────────────────────────────────────
async function ai(system, user, maxTokens, fast) {
  const msg = await client.messages.create({
    model:      fast ? FAST : MODEL,
    max_tokens: maxTokens || 1500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return {
    text:   msg.content?.[0]?.text || '',
    tokens: (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0),
  };
}

function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); }
  catch { return null; }
}

// ── Tavily ────────────────────────────────────────────────────────────────────
async function webSearch(query, n) {
  if (!process.env.TAVILY_API_KEY) return [];
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: n || 4, search_depth: 'basic' }),
      signal: AbortSignal.timeout(7000),
    });
    const d = await r.json();
    return (d.results || []).map(r => r.content || '').filter(Boolean);
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════════════════════
// LOAD USER MEMORY FROM FIREBASE
// ══════════════════════════════════════════════════════════════════════════════
async function loadMemory(uid) {
  if (!uid) return {};
  try {
    const db   = getDb();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists()) return {};
    const d = snap.data();
    return {
      niche:           d.niche || d.boardroomLastNiche || '',
      appMode:         d.appMode || 'expert',
      boardroomIntel:  d.boardroomIntel || null,
      executionMemory: d.executionMemory || {},
      kpis:            d.kpis || {},
      revenuePlan:     d.revenuePlan || {},
      avatarData:      d.avatarData || {},
      voiceProfile:    d.voiceProfile || {},
      runCount:        d.boardroomRunCount || 0,
      offerName:       d.boardroomLastOfferName || '',
    };
  } catch(e) {
    console.warn('[EE] Memory load failed:', e.message);
    return {};
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER AGENT — classifies intent + decides which agents to run
// ══════════════════════════════════════════════════════════════════════════════
async function routerAgent(request, memory, tracer) {
  const { text } = await ai(
    'You are the Router for Execution-OS. Classify the user request and return ONLY valid JSON.',
    [
      'User request: "' + request.message + '"',
      'User niche: ' + (memory.niche || 'unknown'),
      'User mode: ' + (memory.appMode || 'expert'),
      '',
      'Classify this request and return:',
      '{',
      '  "intent": "one of: strategy | offer | content | funnel | analytics | accountability | advice | general",',
      '  "agents": ["list of agents to run: strategy, offer, content, funnel, analytics, accountability"],',
      '  "urgency": "high | medium | low",',
      '  "context": "one sentence: what the user actually needs"',
      '}',
    ].join('\n'),
    300,
    true  // use fast model for routing
  );

  const route = extractJSON(text) || { intent: 'advice', agents: ['strategy'], urgency: 'medium', context: request.message };
  tracer.step('router', route);
  return route;
}

// ══════════════════════════════════════════════════════════════════════════════
// STRATEGY AGENT
// ══════════════════════════════════════════════════════════════════════════════
async function strategyAgent(request, memory, route, tracer) {
  const br     = memory.boardroomIntel || {};
  const arch   = br.architect || {};
  const runNum = memory.runCount || 0;

  const memCtx = runNum > 0 && arch.positioningStatement
    ? 'MEMORY: ' + runNum + ' previous runs. Last positioning: "' + arch.positioningStatement + '". Category: "' + (arch.categoryName || '') + '".'
    : '';

  const prompt = [
    memCtx,
    'User request: "' + request.message + '"',
    'Niche: ' + (memory.niche || 'not set'),
    'Revenue target: $' + (memory.revenuePlan?.target || memory.kpis?.revenueTarget || 'unknown') + '/month',
    'Current positioning: ' + (arch.positioningStatement || 'not yet built'),
    'Immediate win identified: ' + (arch.immediateWin || 'none'),
    '',
    'Give a sharp, specific, actionable strategy response. Reference their actual data.',
    'Return JSON:',
    '{',
    '  "headline": "one bold strategy statement",',
    '  "insight": "2-3 sentences of sharp strategic insight referencing their niche and current position",',
    '  "actions": [',
    '    { "priority": 1, "action": "specific action 1", "why": "why this moves the needle", "timeframe": "today|this week|this month" },',
    '    { "priority": 2, "action": "specific action 2", "why": "reason", "timeframe": "timeframe" },',
    '    { "priority": 3, "action": "specific action 3", "why": "reason", "timeframe": "timeframe" }',
    '  ],',
    '  "warning": "the biggest mistake to avoid right now — specific to their situation",',
    '  "metric": "the one number to track this week"',
    '}',
  ].filter(Boolean).join('\n');

  const { text } = await ai(
    'You are a $100M business strategist embedded in Execution-OS. You know this user\'s full business context. Every response references their specific niche, positioning, and current stage. You are direct, specific, and focused on execution.',
    prompt,
    1500
  );

  const result = extractJSON(text) || { headline: 'Strategy built', insight: text.slice(0, 300), actions: [], warning: '', metric: '' };
  tracer.step('strategy', result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTENT AGENT
// ══════════════════════════════════════════════════════════════════════════════
async function contentAgent(request, memory, tracer) {
  const br  = memory.boardroomIntel || {};
  const cv  = br.copyVault || {};
  const ce  = br.contentEngine || {};
  const av  = memory.avatarData || {};

  // Search for current trends in their niche if Tavily available
  const trendResults = await webSearch(memory.niche + ' content trends 2025', 3);
  const trends = trendResults.join('\n').slice(0, 500);

  const prompt = [
    'User request: "' + request.message + '"',
    'Niche: ' + (memory.niche || 'not set'),
    'Avatar pain: ' + (av.pain || 'their main struggle'),
    'Top hooks from Boardroom: ' + ((cv.hooks || []).slice(0, 2).join(' | ')),
    'Content pillars: ' + ((ce.pillars || []).slice(0, 3).join(', ')),
    trends ? 'Current niche trends:\n' + trends : '',
    '',
    'Generate content recommendations and at least 3 ready-to-use pieces.',
    'Return JSON:',
    '{',
    '  "strategy": "2 sentences on content approach for this specific request",',
    '  "pieces": [',
    '    { "type": "Facebook Post|Reel Script|Email|DM", "hook": "opening hook", "content": "full ready-to-use content", "cta": "call to action" },',
    '    { "type": "type", "hook": "hook", "content": "full content", "cta": "cta" },',
    '    { "type": "type", "hook": "hook", "content": "full content", "cta": "cta" }',
    '  ],',
    '  "postingTips": ["tip 1", "tip 2"],',
    '  "nextContent": "what to create next and why"',
    '}',
  ].filter(Boolean).join('\n');

  const { text } = await ai(
    'You are a world-class content strategist embedded in Execution-OS. You write REAL finished content — not descriptions. Every piece is specific to the user\'s niche and avatar.',
    prompt,
    2000
  );

  const result = extractJSON(text) || { strategy: '', pieces: [], postingTips: [], nextContent: '' };
  tracer.step('content', result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS AGENT — reads KPIs + performance data + gives insights
// ══════════════════════════════════════════════════════════════════════════════
async function analyticsAgent(request, memory, tracer) {
  const kpis    = memory.kpis || {};
  const br      = memory.boardroomIntel || {};
  const arch    = br.architect || {};
  const inputs  = (br.inputs || {});
  const target  = inputs.target || kpis.revenueTarget || 0;
  const price   = inputs.price  || kpis.offerPrice    || 0;

  // Calculate gaps
  const currentRevenue  = kpis.revenue     || 0;
  const revenueGap      = target - currentRevenue;
  const clientsNeeded   = price > 0 ? Math.ceil(revenueGap / price) : 0;
  const leadsNeeded     = Math.ceil(clientsNeeded / 0.25);

  const prompt = [
    'User request: "' + request.message + '"',
    '',
    'CURRENT PERFORMANCE DATA:',
    'Revenue this month: $' + currentRevenue,
    'Revenue target: $' + target + '/month',
    'Revenue gap: $' + revenueGap + ' (' + clientsNeeded + ' more clients needed)',
    'Leads needed to fill gap: ' + leadsNeeded + ' (at 25% close rate)',
    'Content posted this week: ' + (kpis.contentPosted || 0),
    'DMs sent this week: ' + (kpis.dmsSent || 0),
    'Calls booked: ' + (kpis.callsBooked || 0),
    'Deals closed: ' + (kpis.dealsClosed || 0),
    'Niche: ' + (memory.niche || 'not set'),
    'Current positioning: ' + (arch.positioningStatement || 'not built'),
    '',
    'Analyse the performance and give specific, honest insights.',
    'Return JSON:',
    '{',
    '  "scorecard": { "revenue": ' + currentRevenue + ', "target": ' + target + ', "percentToTarget": ' + (target > 0 ? Math.round(currentRevenue/target*100) : 0) + ' },',
    '  "topInsight": "the most important thing the numbers are telling them right now",',
    '  "gaps": [',
    '    { "area": "area with biggest gap", "gap": "specific gap", "fix": "specific fix" },',
    '    { "area": "second area", "gap": "gap", "fix": "fix" }',
    '  ],',
    '  "winThisWeek": "the single action that would most move their numbers",',
    '  "forecast": "if they execute their war plan, what does month 2 look like",',
    '  "redFlag": "anything in these numbers that needs immediate attention"',
    '}',
  ].join('\n');

  const { text } = await ai(
    'You are a data-driven performance analyst embedded in Execution-OS. You read KPIs and execution data and give specific, honest, commercially precise insights. You do not sugarcoat.',
    prompt,
    1500
  );

  const result = extractJSON(text) || { scorecard: {}, topInsight: '', gaps: [], winThisWeek: '', forecast: '', redFlag: '' };
  tracer.step('analytics', result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNTABILITY AGENT — tracks execution consistency + pushes action
// ══════════════════════════════════════════════════════════════════════════════
async function accountabilityAgent(request, memory, tracer) {
  const kpis   = memory.kpis || {};
  const br     = memory.boardroomIntel || {};
  const wp     = br.warPlan || {};
  const phase1 = wp.phase1 || {};

  const prompt = [
    'User request: "' + request.message + '"',
    '',
    'EXECUTION DATA:',
    'Content posted this week: ' + (kpis.contentPosted || 0) + ' (target: 14/week)',
    'DMs sent: ' + (kpis.dmsSent || 0) + ' (target: 20/day)',
    'Days since last Boardroom run: ' + (memory.runCount > 0 ? 'has run ' + memory.runCount + ' times' : 'never run'),
    'War plan phase 1 goal: ' + (phase1.goal || 'not built yet'),
    '',
    'Give accountability coaching — direct, honest, motivating without being generic.',
    'Return JSON:',
    '{',
    '  "executionScore": 0-100,',
    '  "verdict": "honest one-line verdict on their execution this week",',
    '  "whatYouDid": "acknowledge what they actually did",',
    '  "whatYouMissed": "what they should have done but did not",',
    '  "todaysPlan": [',
    '    { "time": "9:00 AM", "task": "specific task", "duration": "30 min", "why": "reason" },',
    '    { "time": "11:00 AM", "task": "specific task", "duration": "45 min", "why": "reason" },',
    '    { "time": "2:00 PM", "task": "specific task", "duration": "30 min", "why": "reason" }',
    '  ],',
    '  "commitment": "the one thing they must commit to doing today — specific and measurable"',
    '}',
  ].join('\n');

  const { text } = await ai(
    'You are an elite accountability coach embedded in Execution-OS. You are direct, honest, and focused on execution. You do not motivate with fluff. You analyse what they did, call out what they did not do, and give a precise action plan.',
    prompt,
    1500
  );

  const result = extractJSON(text) || { executionScore: 0, verdict: '', whatYouDid: '', whatYouMissed: '', todaysPlan: [], commitment: '' };
  tracer.step('accountability', result);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADVICE AGENT — general advisor (replaces generate-advisor endpoint)
// ══════════════════════════════════════════════════════════════════════════════
async function adviceAgent(request, memory, tracer) {
  const br     = memory.boardroomIntel || {};
  const arch   = br.architect || {};
  const inputs = br.inputs || {};
  const av     = memory.avatarData || {};
  const isAff  = memory.appMode === 'affiliate';

  const context = [
    'Mode: ' + (isAff ? 'Affiliate Marketing' : 'Expert/Coach/Consultant'),
    'Niche: ' + (memory.niche || 'not set'),
    isAff
      ? 'Product promoting: ' + (memory.offerName || 'not set')
      : 'Offer: ' + (memory.offerName || inputs.offerName || 'not set') + ' at $' + (inputs.price || 0),
    'Revenue target: $' + (inputs.target || 0) + '/month',
    'Ideal client: ' + (av.job || 'not defined') + ' — pain: "' + (av.pain || '') + '"',
    'Current positioning: ' + (arch.positioningStatement || 'not yet built'),
    'Run count: ' + (memory.runCount || 0) + ' Boardroom runs',
  ].filter(Boolean).join('\n');

  const { text } = await ai(
    'You are Execution-OS — an elite business strategist embedded in a $6,000 business operating system. You know this user\'s full business context. You think like a $10,000 consultant. Every response references their specific data. You are direct, confident, and obsessed with execution. You end every response with one specific action to take TODAY.',
    'BUSINESS CONTEXT:\n' + context + '\n\nUSER QUESTION:\n' + request.message + '\n\nGive a comprehensive, specific answer that references their actual business data. Maximum 400 words. End with: TODAY\'S ACTION: [one specific action]',
    1200
  );

  tracer.step('advice', { reply: text });
  return { reply: text };
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVE EXECUTION TO MEMORY
// ══════════════════════════════════════════════════════════════════════════════
async function saveExecution(uid, intent, output, tracer) {
  if (!uid) return;
  try {
    const db  = getDb();
    const now = Date.now();
    await db.collection('users').doc(uid).update({
      lastExecutionRun:    now,
      lastExecutionIntent: intent,
      executionRunCount:   FieldValue.increment(1),
    });
    // Save to execution history
    await db.collection('users').doc(uid)
      .collection('execution-history')
      .doc(String(now))
      .set({
        intent,
        summary: tracer.summary(),
        savedAt: now,
      });
  } catch(e) {
    console.warn('[EE] Save execution failed:', e.message);
  }
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

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { message, uid, context } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const tracer  = new RunTracer('unknown', uid);
  const request = { message, context: context || {} };

  try {
    // ── Step 1: Load user memory ────────────────────────────────────────────
    const memory = await loadMemory(uid);
    tracer.step('memory_loaded', { runCount: memory.runCount });

    // ── Step 2: Route the request ───────────────────────────────────────────
    const route = await routerAgent(request, memory, tracer);
    tracer.intent = route.intent;

    // ── Step 3: Run the appropriate agent(s) ───────────────────────────────
    const output = {
      intent:   route.intent,
      context:  route.context,
      urgency:  route.urgency,
      strategy:       null,
      content:        null,
      analytics:      null,
      accountability: null,
      advice:         null,
    };

    const agents = route.agents || ['advice'];

    // Run multiple agents in parallel where possible
    const agentPromises = agents.map(agent => {
      switch(agent) {
        case 'strategy':       return strategyAgent(request, memory, route, tracer).then(r => { output.strategy = r; });
        case 'content':        return contentAgent(request, memory, tracer).then(r => { output.content = r; });
        case 'analytics':      return analyticsAgent(request, memory, tracer).then(r => { output.analytics = r; });
        case 'accountability': return accountabilityAgent(request, memory, tracer).then(r => { output.accountability = r; });
        default:               return adviceAgent(request, memory, tracer).then(r => { output.advice = r; });
      }
    });

    await Promise.all(agentPromises);

    // ── Step 4: If no specific agent ran, run advice agent ──────────────────
    if (!output.strategy && !output.content && !output.analytics && !output.accountability && !output.advice) {
      output.advice = await adviceAgent(request, memory, tracer);
    }

    // ── Step 5: Build the primary reply for the chat interface ──────────────
    let primaryReply = '';
    if (output.advice)         primaryReply = output.advice.reply || '';
    if (output.strategy)       primaryReply = formatStrategy(output.strategy);
    if (output.content)        primaryReply = formatContent(output.content);
    if (output.analytics)      primaryReply = formatAnalytics(output.analytics);
    if (output.accountability) primaryReply = formatAccountability(output.accountability);

    output.reply = primaryReply;

    // ── Step 6: Save to memory + LangSmith ─────────────────────────────────
    await Promise.all([
      saveExecution(uid, route.intent, output, tracer),
      tracer.post(output),
    ]);

    return res.status(200).json({
      success:  true,
      reply:    primaryReply,
      intent:   route.intent,
      output,
      tracer:   tracer.summary(),
    });

  } catch(err) {
    console.error('[ExecutionEngine] Error:', err);
    await tracer.post({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

// ── Response formatters — convert structured output to readable text ──────────

function formatStrategy(s) {
  if (!s) return '';
  let out = '## ' + (s.headline || 'Strategy') + '\n\n';
  out += (s.insight || '') + '\n\n';
  if (s.actions && s.actions.length) {
    out += '**Your next moves:**\n';
    s.actions.forEach(a => {
      out += `\n**${a.priority}. ${a.action}** _(${a.timeframe})_\n${a.why}\n`;
    });
  }
  if (s.warning) out += '\n⚠️ **Watch out:** ' + s.warning + '\n';
  if (s.metric)  out += '\n📊 **Track this:** ' + s.metric;
  return out;
}

function formatContent(c) {
  if (!c) return '';
  let out = (c.strategy || '') + '\n\n';
  if (c.pieces && c.pieces.length) {
    c.pieces.forEach(p => {
      out += `**${p.type}**\n_Hook:_ ${p.hook}\n\n${p.content}\n\n_CTA: ${p.cta}_\n\n---\n\n`;
    });
  }
  if (c.nextContent) out += '**Next:** ' + c.nextContent;
  return out;
}

function formatAnalytics(a) {
  if (!a) return '';
  const sc = a.scorecard || {};
  let out = `**Performance: ${sc.percentToTarget || 0}% to target** ($${sc.revenue || 0} of $${sc.target || 0}/month)\n\n`;
  out += (a.topInsight || '') + '\n\n';
  if (a.gaps && a.gaps.length) {
    out += '**Gaps to close:**\n';
    a.gaps.forEach(g => { out += `\n• **${g.area}:** ${g.gap}\n  _Fix: ${g.fix}_\n`; });
  }
  if (a.winThisWeek) out += '\n\n**Win this week:** ' + a.winThisWeek;
  if (a.redFlag)     out += '\n\n🚨 **Red flag:** ' + a.redFlag;
  return out;
}

function formatAccountability(a) {
  if (!a) return '';
  let out = `**Execution Score: ${a.executionScore || 0}/100**\n\n`;
  out += (a.verdict || '') + '\n\n';
  if (a.whatYouDid)    out += '✅ ' + a.whatYouDid + '\n\n';
  if (a.whatYouMissed) out += '❌ ' + a.whatYouMissed + '\n\n';
  if (a.todaysPlan && a.todaysPlan.length) {
    out += "**Today's plan:**\n";
    a.todaysPlan.forEach(t => { out += `\n${t.time} — **${t.task}** (${t.duration})\n_${t.why}_\n`; });
  }
  if (a.commitment) out += '\n\n🎯 **Your commitment:** ' + a.commitment;
  return out;
}
