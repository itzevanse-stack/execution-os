import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MENTOR = `You are the core intelligence of Execution-OS — a 9-Figure Digital Product Mentor and intelligent execution operating system dedicated to helping users build a $100,000/month business. You think, remember, plan, adapt, and execute alongside the user. Every output is grounded in live market data and the user's exact situation. CRITICAL: Return ONLY valid JSON. No markdown fences, no preamble, no explanation.`;

// ── Helper: call Claude, return parsed JSON ───────────────────────────────────
async function callJSON(prompt, maxTokens = 2000) {
  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system:     MENTOR,
    messages:   [{ role: 'user', content: prompt }],
  });
  const raw = (msg.content[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── Helper: Tavily search ─────────────────────────────────────────────────────
async function tavilySearch(query) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        process.env.TAVILY_API_KEY,
        query,
        max_results:    5,
        search_depth:   'basic',
        include_answer: false,
      }),
    });
    const data = await res.json();
    return (data.results || [])
      .slice(0, 4)
      .map((r, i) => `[${i+1}] ${r.title || ''}: ${(r.content || '').slice(0, 280)}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

// ── Node functions ────────────────────────────────────────────────────────────

async function researchMarket(niche) {
  const [competitors, audiencePains, trends] = await Promise.all([
    tavilySearch(`${niche} online business competitors positioning 2025`),
    tavilySearch(`${niche} audience pain points struggles objections`),
    tavilySearch(`${niche} trending content hooks what works 2025`),
  ]);
  return { competitors, audiencePains, trends };
}

async function positionInMarket(inp, answers, market) {
  return callJSON(`
USER CONTEXT:
Niche: ${inp.niche} | Offer: ${inp.offerName} at $${inp.price}
Target: $${inp.target}/mo (${inp.salesNeeded} sales) | Platform: ${answers.q2 || ''}
Audience size: ${answers.q1 || ''} | Pain: ${inp.av_pain || ''} | Fear: ${inp.av_fear || ''}
Transformation: ${inp.transformation || ''} | Obstacle: ${answers.q4 || ''}

LIVE MARKET RESEARCH:
Competitors: ${market.competitors || 'N/A'}
Audience pains: ${market.audiencePains || 'N/A'}
Trends: ${market.trends || 'N/A'}

Find a real gap in the market and use it to differentiate.

Return JSON:
{
  "positioningStatement": "2 sentences — names niche, who, result, differentiating angle from market gap",
  "dominanceAngle": "The uncopyable angle grounded in the market gap you found",
  "uniqueMechanism": "Branded programme name for their proprietary method",
  "targetCustomerSentence": "So specific their ideal client thinks it was written about them",
  "categoryDesign": "Market category they should own that does not yet exist as dominant",
  "marketGapFound": "1 sentence: the specific gap you found in the research"
}`);
}

async function buildWarPlan(inp, answers, positioning, market) {
  return callJSON(`
POSITIONING: ${JSON.stringify(positioning)}
Offer: ${inp.offerName} at $${inp.price} | Sales: ${inp.salesNeeded} in 30 days / ${inp.weeklySales}/week
Platform: ${answers.q2 || ''} | Warm audience: ${answers.q1 || ''} | Obstacle: ${answers.q4 || ''} | Hours+budget: ${answers.q5 || ''}
Trending content: ${market.trends || 'N/A'}

Return JSON:
{
  "week1": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["specific action with HOW", "2", "3", "4", "5"] },
  "week2": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },
  "week3": { "title": "...", "focus": "1 sentence", "goal": "measurable outcome", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },
  "week4": { "title": "...", "focus": "1 sentence", "goal": "connects to hitting monthly target", "dailyNonNeg": "ONE daily action", "actions": ["1", "2", "3", "4", "5"] },
  "primaryChannel": "ONE platform + exactly why for their situation",
  "dmStrategy": "Step-by-step DM approach for their audience size + platform — 3-4 sentences",
  "revenueBreakdown": {
    "monthlyTarget": ${inp.target || 10000}, "offerPrice": ${inp.price || 2000}, "salesNeeded": ${inp.salesNeeded || 5},
    "weeklySalesTarget": "X sales/week to stay on track",
    "dailyNonNegotiable": "ONE activity every day that directly drives a sale"
  }
}`);
}

async function generateCopy(inp, answers, positioning, market) {
  return callJSON(`
POSITIONING: ${JSON.stringify(positioning)}
Niche: ${inp.niche} | Offer: ${inp.offerName} at $${inp.price}
Pain: ${inp.av_pain || ''} | Fear: ${inp.av_fear || ''} | Objections: ${inp.av_objections || ''}
Platform: ${answers.q2 || ''} | Obstacle: ${answers.q4 || ''}
Audience pains (use their exact language): ${market.audiencePains || 'N/A'}
Trending hooks: ${market.trends || 'N/A'}

Return JSON:
{
  "mentorNote": "Direct 2-3 sentence mentor note addressing obstacle — reframes as advantage, specific not generic",
  "closingScript": "3-4 sentence close for verbal or DM — uses offer name, price, transformation",
  "offerPositioning": "How to position this offer for max conversion — 2 sentences with offer name",
  "dmOpeners": ["Authority opener <60 words no pitch", "Value-led opener", "Pain-point opener from research"],
  "week1ContentHooks": ["Hook grounded in trending patterns + niche", "Hook 2", "Hook 3", "Hook 4", "Hook 5"],
  "contentPillars": ["Pillar 1 — specific to niche + avatar pain", "Pillar 2", "Pillar 3"],
  "emailSubjects": ["Subject using audience language", "Subject 2", "Subject 3"],
  "vslOpener": "One VSL opening line — names their pain and transformation, feels like mind-reading",
  "headlines": ["Headline grounded in market gap", "Headline 2", "Headline 3"]
}`);
}

async function analyzeRisk(inp, answers) {
  return callJSON(`
Audience: ${answers.q1 || ''} | Platform: ${answers.q2 || ''} | Experience: ${answers.q3 || ''}
Obstacle: "${answers.q4 || ''}" | Hours+budget: ${answers.q5 || ''} | Sales needed: ${inp.salesNeeded || 5}

Return JSON:
{
  "biggestRisk": "2 sentences — specific risk from what they said + precise action to prevent it",
  "successCondition": "The ONE thing they must get right in week 1 — 1 sentence",
  "warningSignals": ["Observable behaviour that signals drift", "Signal 2", "Signal 3"]
}`);
}

// ── Tab regeneration (backward compat with brRegenerateTab) ──────────────────
async function regenerateTab(tab, inputs, intel) {
  const prompts = {
    'architect':      `Regenerate positioning for niche: ${inputs.niche}, offer: ${inputs.offerName}. Return: { positioningStatement, dominanceAngle, uniqueMechanism, categoryDesign }`,
    'offer-stack':    `Regenerate offer stack for: ${inputs.offerName} at $${inputs.price}. Return: { rebuiltOfferName, coreTransformation, rebuiltGuarantee, pricingJustification, signatureFramework: { name }, valueStack: [], totalValue }`,
    'copy-vault':     `Regenerate copy for ${inputs.offerName} in ${inputs.niche}. Return: { dmOpeners: [], hooks: [], emailSubjects: [], headlines: [], vslOpeningScript, closingScript }`,
    'war-plan':       `Regenerate 4-week plan for ${inputs.offerName}, target $${inputs.target}. Return: { week1, week2, week3, week4, primaryChannel, dmStrategy }`,
    'content-engine': `Regenerate content engine for ${inputs.niche}. Return: { contentPillars: [], week1ContentHooks: [], days: [{ day, theme, reelScript }] for 5 days }`,
  };
  return callJSON(`${prompts[tab] || `Regenerate ${tab} section`}\n\nContext: ${JSON.stringify(intel).slice(0, 600)}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { inputs, answers, mindset, tab, intel } = req.body || {};

  // Backward-compatible tab regeneration
  if (tab && intel) {
    try {
      const result = await regenerateTab(tab, inputs || {}, intel);
      return res.status(200).json({ data: result });
    } catch (err) {
      console.error('[api/boardroom] tab regen error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Full pipeline
  try {
    const inp = inputs || {};
    inp.salesNeeded = Math.ceil((inp.target || 10000) / (inp.price || 2000));
    inp.weeklySales = Math.ceil(inp.salesNeeded / 4);
    const a = answers || {};

    // Step 1: Market research (Tavily) — non-blocking fail
    const market = await researchMarket(inp.niche || 'online business coaching').catch(() => ({ competitors: '', audiencePains: '', trends: '' }));

    // Step 2: Positioning (uses market data)
    const positioning = await positionInMarket(inp, a, market);

    // Step 3: War plan + Copy in parallel
    const [warPlan, copy] = await Promise.all([
      buildWarPlan(inp, a, positioning, market),
      generateCopy(inp, a, positioning, market),
    ]);

    // Step 4: Risk analysis
    const riskData = await analyzeRisk(inp, a);

    // Step 5: Assemble
    const plan = {
      generatedAt:          new Date().toISOString(),
      marketGapFound:       positioning.marketGapFound       || '',
      positioningStatement: positioning.positioningStatement || '',
      dominanceAngle:       positioning.dominanceAngle       || '',
      uniqueMechanism:      positioning.uniqueMechanism       || '',
      categoryDesign:       positioning.categoryDesign        || '',
      revenueBreakdown:     warPlan.revenueBreakdown          || { monthlyTarget: inp.target, offerPrice: inp.price, salesNeeded: inp.salesNeeded },
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
    return res.status(500).json({ error: err.message });
  }
}
