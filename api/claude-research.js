const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * /api/claude-research
 * Web search-enabled endpoint for all research tabs.
 * Used by:
 *   - Boardroom: ICP Research Lab, Competitor Intelligence, Market Viability
 *   - Affiliate Hub: Buyer Research Lab, Promotion Intelligence, Offer Viability
 *
 * Detects affiliate vs expert mode from request content and injects
 * the correct intelligence base — same separation logic as /api/claude.
 */

// ─── Expert Research Intelligence ─────────────────────────────────────────────
const EXPERT_RESEARCH_INTELLIGENCE = `You are a market research analyst operating inside EXECUTION OS — built on the experience of a 9-figure digital product operator. You are conducting research to help someone build and sell THEIR OWN digital product or programme.

All research you conduct must answer the question: what does this person need to know to build a better offer, position it more effectively, and attract their ideal client? You are researching the product creator's market — their competitors, their ideal customers, and whether the market can support the revenue targets they have set.

Be honest. If the market is saturated, say so. If the price ceiling is lower than their target, say so. Give the advice of someone who has operated at the $100M level in digital products — specific, direct, actionable.`;

// ─── Affiliate Research Intelligence ──────────────────────────────────────────
const AFFILIATE_RESEARCH_INTELLIGENCE = `You are a market research analyst operating inside EXECUTION OS — built on the experience of a top affiliate marketer who has generated millions in commissions promoting other people's digital products.

You are conducting research to help someone promote a product they did NOT create as an affiliate. Every insight you produce must be framed for an affiliate, not a creator. The person you are helping:
- Does NOT own the product
- Earns a commission when someone buys through their link
- Needs to build trust and educate BEFORE mentioning the product
- Competes with other affiliates promoting the same or similar products

Your research serves three purposes for the affiliate:
1. BUYER RESEARCH: Who is actually buying products like this, what language do they use, what pushes them to buy, what makes them distrust affiliates
2. PROMOTION INTELLIGENCE: How are other affiliates promoting in this niche, what angles are saturated, what positioning gaps exist
3. OFFER VIABILITY: Can this specific commission structure realistically hit the income target, what audience is needed, what is the honest timeline

Never give advice about "building your offer" or "your mechanism" or "your programme" — the affiliate does not have any of these. Frame everything around promoting, recommending, and building trust.

Be honest. If the commission is too low for the target, say so. If the niche is too saturated for a new affiliate, say so. The affiliate needs the truth before investing 90 days, not after.`;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body     = req.body || {};
  const messages = body.messages;
  const model    = body.model || 'claude-sonnet-4-20250514';
  const system   = body.system;

  if (!messages || !messages.length) {
    return res.status(400).json({ ok: false, error: 'messages required' });
  }

  // ── Mode Detection — same logic as /api/claude ─────────────────────────────
  const msgText  = messages.map(m =>
    typeof m.content === 'string' ? m.content :
    Array.isArray(m.content) ? m.content.map(c => c.text || '').join(' ') : ''
  ).join(' ');
  const bodyText = JSON.stringify(body);

  // Affiliate signals
  const isAffiliate = (
    bodyText.includes('"mode":"affiliate"') ||
    bodyText.includes('build-affiliate') ||
    msgText.includes('affiliate link') ||
    msgText.includes('commission per sale') ||
    msgText.includes('affiliate marketer') ||
    msgText.includes('promoting an affiliate') ||
    msgText.includes('affiliate product') ||
    msgText.includes('This person is an AFFILIATE') ||
    msgText.includes('AFFILIATE promoting') ||
    msgText.includes('Commission per sale') ||
    (body.mode === 'affiliate')
  );

  // Select the correct research intelligence base
  const researchBase = isAffiliate
    ? AFFILIATE_RESEARCH_INTELLIGENCE
    : EXPERT_RESEARCH_INTELLIGENCE;

  // Combine with any caller-provided system prompt
  const combinedSystem = system
    ? researchBase + '\n\n' + '─'.repeat(60) + '\n\nRESEARCH TASK INSTRUCTIONS:\n' + system
    : researchBase;

  // Research calls are token-intensive — they do multiple web searches
  // then synthesise the results into a structured JSON response
  const maxTok = body.max_tokens || 5000;

  try {
    const params = {
      model,
      max_tokens: maxTok,
      messages,
      system: combinedSystem,
      // Web search — up to 10 searches per call for thorough research
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 10
        }
      ]
    };

    const response = await anthropic.messages.create(params);

    // Extract only text blocks — web_search produces tool_use + tool_result
    // blocks during the search process; we only return the final synthesis
    const textContent = (response.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return res.status(200).json({
      ...response,
      content: [{ type: 'text', text: textContent }]
    });

  } catch (err) {
    console.error('[api/claude-research]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
