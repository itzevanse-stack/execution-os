const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MENTOR = 'You are the core intelligence of Execution-OS — a 9-Figure Digital Product Mentor and intelligent execution operating system dedicated to helping users build a $100,000/month business. You think, remember, plan, adapt, and execute alongside the user. Every output is grounded in live market data and the user\'s exact situation. CRITICAL: Return ONLY valid JSON. No markdown fences, no preamble, no explanation.';

async function callJSON(prompt, maxTokens) {
  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: maxTokens || 2000,
    system:     MENTOR,
    messages:   [{ role: 'user', content: prompt }],
  });
  const raw = ((msg.content[0] && msg.content[0].text) || '').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// Basic search — fast, good for trends and audience pains
async function tavilySearch(query, depth) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:      process.env.TAVILY_API_KEY,
        query,
        max_results:  6,
        search_depth: depth || 'basic',
      }),
    });
    const data = await res.json();
    return (data.results || []).slice(0, 5)
      .map(function(r, i) { return '[' + (i+1) + '] ' + (r.title || '') + ': ' + (r.content || '').slice(0, 350); })
      .join('\n\n');
  } catch (e) {
    return '';
  }
}

// Deep research — uses Tavily research API for comprehensive analysis
// Only used for Market Viability and Competitor Intel where depth matters
async function tavilyResearch(query) {
  if (!process.env.TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/research', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + process.env.TAVILY_API_KEY,
      },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        max_results:  8,
      }),
      signal: AbortSignal.timeout(90000), // research takes up to 90s
    });
    if (!res.ok) return '';
    const data = await res.json();
    // Research returns answer + sources
    const answer  = data.answer  || '';
    const sources = (data.results || []).slice(0, 5)
      .map(function(r) { return '[' + r.title + ']: ' + (r.content || '').slice(0, 300); })
      .join('\n');
    return answer ? answer + '\n\nSources:\n' + sources : sources;
  } catch (e) {
    console.warn('[boardroom] tavilyResearch failed:', e.message, '— falling back to basic search');
    return tavilySearch(query, 'advanced'); // graceful fallback
  }
}

async function researchMarket(niche) {
  const results = await Promise.all([
    // Advanced depth for competitor intel — this is where depth pays off most
    tavilySearch(niche + ' online business competitors pricing positioning differentiation 2025', 'advanced'),
    // Advanced depth for real audience language from forums
    tavilySearch(niche + ' audience pain points struggles reddit forum "I wish" OR "I hate" OR "I need" 2025', 'advanced'),
    // Basic for trends — fast-moving, recency matters more than depth
    tavilySearch(niche + ' trending content hooks viral what works 2025'),
    // Additional: market size and viability data
    tavilySearch(niche + ' market size revenue industry growth 2024 2025'),
  ]);
  return {
    competitors:   results[0],
    audiencePains: results[1],
    trends:        results[2],
    marketSize:    results[3],
  };
}

async function positionInMarket(inp, answers, market) {
  return callJSON(
    'USER CONTEXT:\n'
    + 'Niche: ' + inp.niche + ' | Offer: ' + inp.offerName + ' at $' + inp.price + '\n'
    + 'Target: $' + inp.target + '/mo (' + inp.salesNeeded + ' sales) | Platform: ' + (answers.q2 || '') + '\n'
    + 'Audience size: ' + (answers.q1 || '') + ' | Pain: ' + (inp.av_pain || '') + ' | Fear: ' + (inp.av_fear || '') + '\n'
    + 'Transformation: ' + (inp.transformation || '') + ' | Obstacle: ' + (answers.q4 || '') + '\n\n'
    + 'LIVE MARKET RESEARCH:\n'
    + 'Competitors: ' + (market.competitors || 'N/A') + '\n'
    + 'Audience pains: ' + (market.audiencePains || 'N/A') + '\n'
    + 'Trends: ' + (market.trends || 'N/A') + '\n'
    + 'Market size/viability: ' + (market.marketSize || 'N/A') + '\n\n'
    + 'Find a real gap in the market and use it to differentiate.\n\n'
    + 'Return JSON:\n'
    + '{\n'
    + '  "positioningStatement": "2 sentences — names niche, who, result, differentiating angle from market gap",\n'
    + '  "dominanceAngle": "The uncopyable angle grounded in the market gap",\n'
    + '  "uniqueMechanism": "Branded programme name for their proprietary method",\n'
    + '  "targetCustomerSentence": "So specific their ideal client thinks it was written about them",\n'
    + '  "categoryDesign": "Market category they should own",\n'
    + '  "marketGapFound": "1 sentence: the specific gap you found in the research"\n'
    + '}'
  );
}

async function buildWarPlan(inp, answers, positioning, market) {
  return callJSON(
    'POSITIONING: ' + JSON.stringify(positioning) + '\n'
    + 'Offer: ' + inp.offerName + ' at $' + inp.price + ' | Sales: ' + inp.salesNeeded + ' in 30 days / ' + inp.weeklySales + '/week\n'
    + 'Platform: ' + (answers.q2 || '') + ' | Warm audience: ' + (answers.q1 || '') + ' | Obstacle: ' + (answers.q4 || '') + ' | Hours+budget: ' + (answers.q5 || '') + '\n'
    + 'Trending content: ' + (market.trends || 'N/A') + '\n'
    + 'Market data: ' + (market.marketSize || 'N/A') + '\n\n'
    + 'Return JSON:\n'
    + '{\n'
    + '  "week1": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["specific action with HOW", "2", "3", "4", "5"] },\n'
    + '  "week2": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },\n'
    + '  "week3": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },\n'
    + '  "week4": { "title": "...", "focus": "1 sentence", "goal": "connects to monthly target", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },\n'
    + '  "primaryChannel": "ONE platform + exactly why for their situation",\n'
    + '  "dmStrategy": "Step-by-step DM approach for their audience size + platform — 3-4 sentences",\n'
    + '  "revenueBreakdown": {\n'
    + '    "monthlyTarget": ' + inp.target + ', "offerPrice": ' + inp.price + ', "salesNeeded": ' + inp.salesNeeded + ',\n'
    + '    "weeklySalesTarget": "X sales/week to stay on track",\n'
    + '    "dailyNonNegotiable": "ONE activity every day that directly drives a sale"\n'
    + '  }\n'
    + '}'
  );
}

async function generateCopy(inp, answers, positioning, market) {
  return callJSON(
    'POSITIONING: ' + JSON.stringify(positioning) + '\n'
    + 'Niche: ' + inp.niche + ' | Offer: ' + inp.offerName + ' at $' + inp.price + '\n'
    + 'Pain: ' + (inp.av_pain || '') + ' | Fear: ' + (inp.av_fear || '') + ' | Objections: ' + (inp.av_objections || '') + '\n'
    + 'Platform: ' + (answers.q2 || '') + ' | Obstacle: ' + (answers.q4 || '') + '\n'
    + 'Audience pains (use their exact language): ' + (market.audiencePains || 'N/A') + '\n'
    + 'Trending hooks: ' + (market.trends || 'N/A') + '\n\n'
    + 'Return JSON:\n'
    + '{\n'
    + '  "mentorNote": "Direct 2-3 sentence mentor note addressing obstacle — reframes as advantage",\n'
    + '  "closingScript": "3-4 sentence close for verbal or DM — uses offer name, price, transformation",\n'
    + '  "offerPositioning": "How to position this offer for max conversion — 2 sentences",\n'
    + '  "dmOpeners": ["Authority opener <60 words no pitch", "Value-led opener", "Pain-point opener from research"],\n'
    + '  "week1ContentHooks": ["Hook grounded in trending patterns + niche", "Hook 2", "Hook 3", "Hook 4", "Hook 5"],\n'
    + '  "contentPillars": ["Pillar 1 — specific to niche + avatar pain", "Pillar 2", "Pillar 3"],\n'
    + '  "emailSubjects": ["Subject using audience language", "Subject 2", "Subject 3"],\n'
    + '  "vslOpener": "One VSL opening line — names their pain and transformation",\n'
    + '  "headlines": ["Headline grounded in market gap", "Headline 2", "Headline 3"]\n'
    + '}'
  );
}

async function analyzeRisk(inp, answers) {
  return callJSON(
    'Audience: ' + (answers.q1 || '') + ' | Platform: ' + (answers.q2 || '') + ' | Experience: ' + (answers.q3 || '') + '\n'
    + 'Obstacle: "' + (answers.q4 || '') + '" | Hours+budget: ' + (answers.q5 || '') + ' | Sales needed: ' + inp.salesNeeded + '\n\n'
    + 'Return JSON:\n'
    + '{\n'
    + '  "biggestRisk": "2 sentences — specific risk from what they said + precise action to prevent it",\n'
    + '  "successCondition": "The ONE thing they must get right in week 1 — 1 sentence",\n'
    + '  "warningSignals": ["Observable behaviour that signals drift", "Signal 2", "Signal 3"]\n'
    + '}'
  );
}

async function regenerateTab(tab, inputs, intel) {
  var prompts = {
    'architect':      'Regenerate positioning for niche: ' + inputs.niche + ', offer: ' + inputs.offerName + '. Return: { positioningStatement, dominanceAngle, uniqueMechanism, categoryDesign }',
    'offer-stack':    'Regenerate offer stack for: ' + inputs.offerName + ' at $' + inputs.price + '. Return: { rebuiltOfferName, coreTransformation, rebuiltGuarantee, pricingJustification, signatureFramework: { name }, valueStack: [], totalValue }',
    'copy-vault':     'Regenerate copy for ' + inputs.offerName + ' in ' + inputs.niche + '. Return: { dmOpeners: [], hooks: [], emailSubjects: [], headlines: [], vslOpeningScript, closingScript }',
    'war-plan':       'Regenerate 4-week plan for ' + inputs.offerName + ', target $' + inputs.target + '. Return: { week1, week2, week3, week4, primaryChannel, dmStrategy }',
    'content-engine': 'Regenerate content engine for ' + inputs.niche + '. Return: { contentPillars: [], week1ContentHooks: [], days: [{ day, theme, reelScript }] for 5 days }',
  };
  return callJSON((prompts[tab] || 'Regenerate ' + tab + ' section') + '\n\nContext: ' + JSON.stringify(intel).slice(0, 600));
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body    = req.body || {};
  const inputs  = body.inputs  || {};
  const answers = body.answers || {};
  const mindset = body.mindset || {};
  const tab     = body.tab;
  const intel   = body.intel;

  // Backward-compatible tab regeneration
  if (tab && intel) {
    try {
      const result = await regenerateTab(tab, inputs, intel);
      return res.status(200).json({ data: result });
    } catch (err) {
      console.error('[api/boardroom] tab regen error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // Full pipeline
  try {
    const inp = inputs;
    inp.salesNeeded = Math.ceil((inp.target || 10000) / (inp.price || 2000));
    inp.weeklySales = Math.ceil(inp.salesNeeded / 4);

    // Step 1: Market research (Tavily) — non-fatal
    const market = await researchMarket(inp.niche || 'online business coaching').catch(function() {
      return { competitors: '', audiencePains: '', trends: '' };
    });

    // Step 2: Positioning (uses market data)
    const positioning = await positionInMarket(inp, answers, market);

    // Step 3: War plan + Copy in parallel
    const parallel = await Promise.all([
      buildWarPlan(inp, answers, positioning, market),
      generateCopy(inp, answers, positioning, market),
    ]);
    const warPlan = parallel[0];
    const copy    = parallel[1];

    // Step 4: Risk analysis
    const riskData = await analyzeRisk(inp, answers);

    // Step 5: Assemble
    const plan = {
      generatedAt:          new Date().toISOString(),
      marketGapFound:       positioning.marketGapFound       || '',
      positioningStatement: positioning.positioningStatement || '',
      dominanceAngle:       positioning.dominanceAngle       || '',
      uniqueMechanism:      positioning.uniqueMechanism       || '',
      categoryDesign:       positioning.categoryDesign        || '',
      revenueBreakdown:     warPlan.revenueBreakdown || { monthlyTarget: inp.target, offerPrice: inp.price, salesNeeded: inp.salesNeeded },
      week1:           warPlan.week1          || {},
      week2:           warPlan.week2          || {},
      week3:           warPlan.week3          || {},
      week4:           warPlan.week4          || {},
      primaryChannel:  warPlan.primaryChannel || '',
      dmStrategy:      warPlan.dmStrategy     || '',
      mentorNote:        copy.mentorNote        || '',
      closingScript:     copy.closingScript     || '',
      offerPositioning:  copy.offerPositioning  || '',
      dmOpeners:         copy.dmOpeners         || [],
      week1ContentHooks: copy.week1ContentHooks || [],
      contentPillars:    copy.contentPillars    || [],
      emailSubjects:     copy.emailSubjects     || [],
      vslOpener:         copy.vslOpener         || '',
      headlines:         copy.headlines         || [],
      biggestRisk:       riskData.biggestRisk      || '',
      successCondition:  riskData.successCondition || '',
      warningSignals:    riskData.warningSignals   || [],
    };

    return res.status(200).json({ data: plan });

  } catch (err) {
    console.error('[api/boardroom]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
