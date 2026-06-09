// api/affiliate-intel.js — Affiliate Intelligence Agent
// Powered by Tavily web search + LangSmith tracing
// Mirrors the Expert Boardroom quality for affiliate marketers
// maxDuration: 300 in vercel.json

const Anthropic = require('@anthropic-ai/sdk');

// ── LangSmith setup ───────────────────────────────────────────────────────────
if (process.env.LANGCHAIN_API_KEY) {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_PROJECT    = process.env.LANGCHAIN_PROJECT || 'execution-os-boardroom';
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-20250514';

// ── LangSmith run tracker ─────────────────────────────────────────────────────
class RunTracer {
  constructor(name, tags) {
    this.name    = name;
    this.tags    = tags || [];
    this.runId   = 'aff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
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
    return {
      runId:       this.runId,
      totalMs:     Date.now() - this.startMs,
      totalTokens: this.spans.reduce((s, sp) => s + sp.tokens, 0),
      failed:      this.spans.filter(sp => sp.error).map(sp => sp.name),
    };
  }
  async post(state) {
    if (!process.env.LANGCHAIN_API_KEY) return;
    try {
      await fetch('https://api.smith.langchain.com/runs', {
        method:  'POST',
        headers: { 'x-api-key': process.env.LANGCHAIN_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:         this.runId,
          name:       this.name,
          run_type:   'chain',
          inputs:     { productName: state.productName, niche: state.niche, commission: state.commission },
          outputs:    { tabs: Object.keys(state).filter(k => ['avatar','positioning','copyVault','warPlan','contentEngine'].includes(k) && state[k] && Object.keys(state[k]).length > 0) },
          start_time: new Date(this.startMs).toISOString(),
          end_time:   new Date().toISOString(),
          extra:      { metadata: { tags: this.tags, spans: this.spans } },
        }),
      }).catch(() => {});
      console.log('[AffIntel] LangSmith run posted:', this.runId);
    } catch(e) {}
  }
}

// ── Core AI call ──────────────────────────────────────────────────────────────
async function ai(systemPrompt, userPrompt, maxTokens) {
  const msg   = await client.messages.create({
    model:      MODEL,
    max_tokens: maxTokens || 2000,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  const text   = msg.content?.[0]?.text || '';
  const tokens = (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0);
  return { text, tokens };
}

// ── JSON extractor ────────────────────────────────────────────────────────────
function extractJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = clean.indexOf('{');
  const e = clean.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); }
  catch {
    let attempt = clean.slice(s);
    const opens  = (attempt.match(/\{/g) || []).length;
    const closes = (attempt.match(/\}/g) || []).length;
    attempt += '}'.repeat(Math.max(0, opens - closes));
    try { return JSON.parse(attempt); } catch { return null; }
  }
}

// ── Tavily web search ─────────────────────────────────────────────────────────
async function webSearch(query, maxResults) {
  if (!process.env.TAVILY_API_KEY) return [];
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        process.env.TAVILY_API_KEY,
        query,
        max_results:    maxResults || 4,
        search_depth:   'basic',
        include_answer: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    return (data.results || []).map(r => r.content || '').filter(Boolean);
  } catch { return []; }
}

// ── Product page extractor via Tavily (replaces raw HTML scraper) ───────────
async function scrapeProduct(url) {
  if (!url) return '';

  // Method 1: Tavily extract — handles JS-rendered pages, returns clean markdown
  if (process.env.TAVILY_API_KEY) {
    try {
      const resp = await fetch('https://api.tavily.com/extract', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.TAVILY_API_KEY },
        body: JSON.stringify({
          urls:          [url],
          extract_depth: 'advanced',
          format:        'markdown',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const result = (data.results || [])[0] || {};
        const text = result.raw_content || result.content || '';
        if (text && text.length > 200) {
          console.log('[affiliate-intel] Tavily extract: ' + text.length + ' chars from ' + url);
          return text.slice(0, 6000); // more content than raw HTML scrape
        }
      }
    } catch (extractErr) {
      console.warn('[affiliate-intel] Tavily extract failed:', extractErr.message);
    }
  }

  // Method 2: Fallback to raw HTML scrape (Jina reader proxy for JS pages)
  try {
    const jinaUrl = 'https://r.jina.ai/' + url;
    const resp = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.length > 200) return text.slice(0, 5000);
    }
  } catch {}

  // Method 3: Direct raw HTML
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 5000);
  } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════════
// AFFILIATE INTELLIGENCE GRAPH NODES
// ══════════════════════════════════════════════════════════════════════════════

// ── Node 1: Scrape + research the product ─────────────────────────────────────
async function node_research_product(state, tracer) {
  const span = tracer.span('research_product');

  // Parallel: scrape product page + search for market intel
  const [pageContent, audienceResults, competitorResults, buyerLanguageResults] = await Promise.all([
    scrapeProduct(state.productUrl),
    webSearch('"' + (state.niche || 'online business') + '" buyer pain struggles reddit forum', 5),
    webSearch((state.productName || 'affiliate product') + ' review results testimonials complaints', 4),
    webSearch('"' + (state.niche || 'online business') + '" reddit "I tried" OR "disappointed" OR "worth it" OR "scam" site:reddit.com', 4),
  ]);

  let marketIntel = [...audienceResults, ...competitorResults, ...buyerLanguageResults].join('\n').slice(0, 3000);



  // If Tavily not configured, synthesise market intel
  if (!marketIntel || marketIntel.length < 50) {
    const synth = await ai(
      'You are an expert market researcher with deep knowledge of ' + (state.niche || 'online business') + '.',
      'Generate realistic market intelligence for an affiliate promoting:\n' +
      'Product: ' + (state.productName || 'online programme') + '\n' +
      'Niche: ' + (state.niche || 'online business') + '\n\n' +
      'Write 6 specific bullet points:\n' +
      '- Real phrases buyers use to describe their pain\n' +
      '- What they tried before that failed\n' +
      '- What success looks like to them\n' +
      '- Biggest fear about buying\n' +
      '- What finally makes them buy\n' +
      '- Common objections to this type of product',
      600
    );
    marketIntel = synth.text;
    span.end(synth.tokens);
  } else {
    span.end(0);
  }

  return { ...state, pageContent, marketIntel };
}

// ── Node 2: Build affiliate avatar ────────────────────────────────────────────
async function node_build_avatar(state, tracer) {
  const span = tracer.span('build_affiliate_avatar');

  const contextSection = state.pageContent && state.pageContent.length > 100
    ? 'REAL PRODUCT PAGE CONTENT:\n"""\n' + state.pageContent.slice(0, 3000) + '\n"""\n\nBase ALL analysis on this actual content.'
    : 'Product: "' + (state.productName || 'affiliate programme') + '" in ' + state.niche + ' niche.';

  const prompt = [
    'Build a precise buyer avatar for this affiliate product. Base everything on the actual product content.',
    contextSection,
    'MARKET RESEARCH:\n' + (state.marketIntel || '').slice(0, 500),
    'Commission: $' + (state.commission || 1000) + ' per sale',
    'Monthly target: $' + (state.monthlyTarget || 10000),
    '',
    'Return ONLY valid JSON:',
    '{',
    '  "name": "avatar name",',
    '  "age": "age range",',
    '  "job": "exact job title of ideal buyer",',
    '  "income": "current income",',
    '  "pain": "core pain in 5-7 words — specific to this product",',
    '  "desire": "what they desperately want",',
    '  "fear": "biggest fear about buying this type of product",',
    '  "tried": "what they already tried that failed",',
    '  "transformation": "exact transformation this product delivers",',
    '  "motivation": "what drives them beyond the result",',
    '  "objections": "top 2 objections specific to this product",',
    '  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],',
    '  "realClaims": ["actual claim from product 1", "actual claim 2", "actual claim 3"],',
    '  "contentAngles": ["angle based on real benefit 1", "angle 2", "angle 3"]',
    '}',
  ].join('\n');

  const { text, tokens } = await ai(
    'You are an elite market researcher and buyer psychology expert. You build buyer avatars from real product data, not assumptions.',
    prompt,
    1500
  );
  const avatar = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, avatar };
}

// ── Node 3: Build affiliate positioning ──────────────────────────────────────
async function node_build_positioning(state, tracer) {
  const span = tracer.span('build_affiliate_positioning');
  const av   = state.avatar || {};

  const prompt = [
    'Build affiliate positioning strategy. Return ONLY valid JSON.',
    '',
    'Product: ' + (state.productName || 'affiliate product'),
    'Niche: ' + state.niche,
    'Commission: $' + state.commission + '/sale | Target: $' + state.monthlyTarget + '/month',
    'Avatar pain: "' + (av.pain || 'their struggle') + '"',
    'Avatar desire: "' + (av.desire || 'their goal') + '"',
    'Product claims: ' + (av.realClaims || []).join(', '),
    'Market intel: ' + (state.marketIntel || '').slice(0, 400),
    '',
    '{',
    '  "promotionAngle": "The unique angle YOU take to promote this product — what makes YOUR promotion different from 1000 other affiliates",',
    '  "audienceNiche": "The specific sub-audience within ' + state.niche + ' who are most likely to buy",',
    '  "authenticStory": "The personal story or connection to this product that makes promotion feel genuine",',
    '  "contentPillars": ["pillar 1", "pillar 2", "pillar 3", "pillar 4"],',
    '  "revenueBreakdown": {',
    '    "salesNeeded": ' + Math.ceil((state.monthlyTarget || 10000) / (state.commission || 1000)) + ',',
    '    "closingRate": "3-5%",',
    '    "leadsNeeded": ' + Math.ceil((state.monthlyTarget || 10000) / (state.commission || 1000) * 25) + ',',
    '    "dailyActions": "3 specific daily actions to generate traffic and leads for this affiliate product"',
    '  },',
    '  "topMistakes": ["mistake affiliates make in ' + state.niche + ' 1", "mistake 2", "mistake 3"],',
    '  "immediateAction": "The ONE action to take today to start generating leads for this product"',
    '}',
  ].join('\n');

  const { text, tokens } = await ai(
    'You are a $100M affiliate marketing strategist. You know that the affiliate cannot change the product — their edge is positioning, audience selection, and authentic promotion. You give specific, commercially precise advice.',
    prompt,
    2000
  );
  const positioning = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, positioning };
}

// ── Node 4a: Build affiliate copy vault ──────────────────────────────────────
async function node_build_copy_vault(state, tracer) {
  const span = tracer.span('build_affiliate_copy_vault');
  const av   = state.avatar || {};
  const pos  = state.positioning || {};

  const prompt = [
    'Write a complete affiliate Copy Vault. NEVER mention commission or that this is affiliate marketing.',
    'Return ONLY valid JSON. Every field = real, finished, ready-to-post copy.',
    '',
    'Product: ' + (state.productName || 'the programme'),
    'Niche: ' + state.niche,
    'Avatar pain: "' + (av.pain || '') + '"',
    'Promotion angle: ' + (pos.promotionAngle || ''),
    'Real product claims: ' + (av.realClaims || []).join(' | '),
    '',
    '{',
    '  "headlines": ["headline 1", "headline 2", "headline 3", "headline 4", "headline 5"],',
    '  "hooks": ["hook 1 stops scroll", "hook 2 curiosity", "hook 3 bold claim", "hook 4 story", "hook 5 question"],',
    '  "dmOpeners": ["after comment", "after follow", "cold dm", "referral dm", "event-based dm"],',
    '  "emailSubjects": ["subject 1", "subject 2", "subject 3", "subject 4", "subject 5"],',
    '  "promotionScript": "90-second natural spoken promotion script: HOOK (10s) + PAIN agitation (30s) + PRODUCT introduction (20s) + RESULT teaser (20s) + CTA (10s). Never sound salesy.",',
    '  "objectionHandlers": {',
    '    "price": "handle: too expensive",',
    '    "trust": "handle: not sure it works",',
    '    "time": "handle: no time",',
    '    "timing": "handle: not now"',
    '  }',
    '}',
  ].join('\n');

  const { text, tokens } = await ai(
    'You are the best affiliate copywriter alive. You write authentic promotion copy that never sounds like advertising. Your copy makes the reader feel like a trusted friend is sharing something that changed their life.',
    prompt,
    3000
  );
  const copyVault = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, copyVault };
}

// ── Node 4b: Build affiliate war plan ─────────────────────────────────────────
async function node_build_war_plan(state, tracer) {
  const span      = tracer.span('build_affiliate_war_plan');
  const niche     = state.niche || 'Online Business';
  const product   = state.productName || 'affiliate product';
  const comm      = state.commission || 1000;
  const target    = state.monthlyTarget || 10000;
  const salesNeed = Math.ceil(target / comm);
  const pos       = state.positioning || {};

  const userPrompt = [
    'Build a 30-day affiliate launch war plan. Return ONLY valid JSON.',
    '',
    'Niche: ' + niche,
    'Product: ' + product,
    'Commission: $' + comm + '/sale | Target: $' + target + '/month (' + salesNeed + ' sales needed)',
    'Traffic strategy: Organic content + DMs',
    '',
    'RULE: Every action must be specific — name the exact platform, content type, or message.',
    'RULE: Never mention commission or affiliate relationship in public content.',
    '',
    '{',
    '  "phase1": {',
    '    "title": "Build Trust (Days 1-7)",',
    '    "goal": "[specific trust-building goal for ' + niche + ' affiliates]",',
    '    "days": [',
    '      { "day": 1, "focus": "[specific task]", "actions": ["[specific action for ' + niche + ']", "[action]", "[action]"] },',
    '      { "day": 2, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 3, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 4, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 5, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 6, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 7, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] }',
    '    ]',
    '  },',
    '  "phase2": {',
    '    "title": "Introduce the Product (Days 8-14)",',
    '    "goal": "[specific introduction goal]",',
    '    "days": [',
    '      { "day": 8,  "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 9,  "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 10, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 11, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 12, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 13, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 14, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] }',
    '    ]',
    '  },',
    '  "phase3": {',
    '    "title": "Drive Sales (Days 15-21)",',
    '    "goal": "[first ' + Math.ceil(salesNeed / 2) + ' sales goal]",',
    '    "days": [',
    '      { "day": 15, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 16, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 17, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 18, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 19, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 20, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 21, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] }',
    '    ]',
    '  },',
    '  "phase4": {',
    '    "title": "Scale (Days 22-30)",',
    '    "goal": "[hit ' + salesNeed + ' total sales goal]",',
    '    "days": [',
    '      { "day": 22, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 25, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 28, "focus": "[task]", "actions": ["[action]", "[action]", "[action]"] },',
    '      { "day": 30, "focus": "Month 2 planning", "actions": ["[action]", "[action]", "[action]"] }',
    '    ]',
    '  },',
    '  "metrics": ["[KPI 1 for ' + niche + ' affiliate]", "[KPI 2]", "[KPI 3]"],',
    '  "criticalWarning": "[The #1 mistake ' + niche + ' affiliates make — be specific]"',
    '}',
  ].join('\n');

  const { text, tokens } = await ai(
    'You are the world\'s best affiliate launch strategist. You give SPECIFIC, EXECUTABLE daily actions. Every action names the exact platform, content type, and target. No generic advice.',
    userPrompt,
    5000
  );
  const warPlan = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, warPlan };
}

// ── Node 5: Build affiliate content engine ────────────────────────────────────
async function node_build_content_engine(state, tracer) {
  const span  = tracer.span('build_affiliate_content');
  const av    = state.avatar || {};
  const pos   = state.positioning || {};
  const cv    = state.copyVault || {};
  const hooks = cv.hooks ? cv.hooks.slice(0, 2).join(' | ') : '';

  const userPrompt = [
    'Build 7 days of affiliate promotion content. Return ONLY valid JSON.',
    'NEVER mention commission. NEVER say "affiliate". Sound like a genuine recommendation.',
    '',
    'Product: ' + (state.productName || 'the programme'),
    'Niche: ' + state.niche,
    'Avatar pain: "' + (av.pain || '') + '"',
    'Hooks to use: ' + hooks,
    'Strategy: Days 1-2 build trust/educate. Days 3-4 introduce product naturally. Days 5-6 social proof. Day 7 CTA.',
    '',
    '{',
    '  "pillars": ["pillar 1", "pillar 2", "pillar 3", "pillar 4", "pillar 5"],',
    '  "days": [',
    '    {',
    '      "day": 1,',
    '      "theme": "problem education — no product mention",',
    '      "fbPost": "complete 120-word post. First sentence stops scroll. Personal angle. Ends with question.",',
    '      "fbPost2": "complete 120-word post 2. Different angle — value-based. Ends with question.",',
    '      "reelScript": "HOOK: [3-sec opener] | CONTENT: [3 specific points] | CTA: [5-sec action]",',
    '      "emailSubject": "subject line",',
    '      "emailBody": "complete 100-word email. Honest, direct, helpful. One clear action."',
    '    },',
    '    { "day": 2, "theme": "deepen problem", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },',
    '    { "day": 3, "theme": "introduce product naturally", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },',
    '    { "day": 4, "theme": "go deeper on product", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },',
    '    { "day": 5, "theme": "proof and results", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },',
    '    { "day": 6, "theme": "handle objections", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" },',
    '    { "day": 7, "theme": "clear call to action", "fbPost": "complete post", "fbPost2": "complete post 2", "reelScript": "HOOK: | CONTENT: | CTA:", "emailSubject": "subject", "emailBody": "complete email" }',
    '  ]',
    '}',
  ].join('\n');

  const { text, tokens } = await ai(
    'You are the best affiliate content strategist. Every post sounds like a trusted friend sharing something that genuinely helped them. Real, finished, human-sounding content — never AI filler.',
    userPrompt,
    5000
  );
  const contentEngine = extractJSON(text) || {};
  span.end(tokens);
  return { ...state, contentEngine };
}

// ── Node 6: Validate output ───────────────────────────────────────────────────
function node_validate(state) {
  const tabs = { avatar: state.avatar, positioning: state.positioning, copyVault: state.copyVault, warPlan: state.warPlan, contentEngine: state.contentEngine };
  const tabScores = {};
  const emptyTabs = [];
  for (const [name, data] of Object.entries(tabs)) {
    const keys = Object.keys(data || {}).filter(k => {
      const v = (data || {})[k];
      return v && (typeof v === 'string' ? v.length > 10 : Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v).length > 0 : false);
    });
    tabScores[name] = Math.round((keys.length / Math.max(1, Object.keys(data || {}).length)) * 100);
    if (!data || Object.keys(data).length === 0) emptyTabs.push(name);
  }
  return { ...state, tabScores, emptyTabs };
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

  const { inputs } = req.body || {};
  if (!inputs) return res.status(400).json({ error: 'Missing inputs' });

  const tracer = new RunTracer('affiliate-intel-run', [inputs.niche, inputs.productName, '$' + inputs.commission]);

  try {
    let state = {
      productName:    inputs.productName   || inputs.offerName || 'Affiliate Product',
      productUrl:     inputs.productUrl    || '',
      niche:          inputs.niche         || 'Online Business',
      commission:     parseInt(inputs.commission || inputs.affCommission || 1000),
      monthlyTarget:  parseInt(inputs.monthlyTarget || inputs.target || 10000),
      trafficMode:    inputs.trafficMode   || 'organic',
      avatar:         inputs.existingAvatar || {},
    };

    // Run the 6-node graph
    state = await node_research_product(state, tracer);
    state = await node_build_avatar(state, tracer);

    // Parallel: positioning + copy + war plan
    const [afterPos, afterCopy, afterWar] = await Promise.all([
      node_build_positioning(state, tracer),
      node_build_copy_vault(state, tracer),
      node_build_war_plan(state, tracer),
    ]);
    state = { ...state, positioning: afterPos.positioning, copyVault: afterCopy.copyVault, warPlan: afterWar.warPlan };

    state = await node_build_content_engine(state, tracer);
    state = node_validate(state);

    await tracer.post(state);

    return res.status(200).json({
      success:       true,
      generatedAt:   Date.now(),
      avatar:        state.avatar        || {},
      positioning:   state.positioning   || {},
      copyVault:     state.copyVault     || {},
      warPlan:       state.warPlan       || {},
      contentEngine: state.contentEngine || {},
      marketIntel:   state.marketIntel   || '',
      tabScores:     state.tabScores     || {},
      emptyTabs:     state.emptyTabs     || [],
      tracer:        tracer.summary(),
    });

  } catch(err) {
    console.error('[AffIntel] Error:', err);
    await tracer.post({ niche: inputs.niche, productName: inputs.productName });
    return res.status(500).json({ error: err.message });
  }
};
