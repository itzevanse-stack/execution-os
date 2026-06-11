// api/vpe-questions.js
// Real-time question discovery for the Value Post Engine
// Sources: Reddit, Quora, Google PAA, AnswerThePublic-style queries via Tavily
// Then ranked and enriched by Claude for relevance to the user's offer

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { niche, intel, mode } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche is required' });

  const TAVILY_KEY  = process.env.TAVILY_API_KEY;
  const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY;

  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    // ── Step 1: Multi-source Tavily searches in parallel ─────────────────────
    const searches = [
      // Reddit — real community questions
      { query: `site:reddit.com "${niche}" questions help advice`, tag: 'reddit' },
      // Quora — curated Q&A
      { query: `site:quora.com "${niche}"`, tag: 'quora' },
      // Google People Also Ask style — informational
      { query: `"${niche}" how to beginners guide common questions`, tag: 'google' },
      // Commercial intent — buyer questions
      { query: `"${niche}" best way to start is it worth it results proof`, tag: 'google' },
    ];

    const tavilyResults = await Promise.allSettled(
      searches.map(s =>
        fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: TAVILY_KEY,
            query: s.query,
            search_depth: 'advanced',
            max_results: 6,
            include_answer: true,
            include_raw_content: false,
          }),
        }).then(r => r.json()).then(d => ({ ...d, _tag: s.tag }))
      )
    );

    // ── Step 2: Extract raw titles/snippets from results ─────────────────────
    const rawResults = [];
    for (const result of tavilyResults) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      const tag  = data._tag || 'web';
      if (data.results) {
        for (const r of data.results) {
          rawResults.push({
            title:   r.title   || '',
            snippet: r.content || '',
            url:     r.url     || '',
            tag,
          });
        }
      }
    }

    if (rawResults.length === 0) {
      // Fallback — Claude generates from training knowledge if Tavily returns nothing
      return await fallbackGenerate(niche, intel, mode, CLAUDE_KEY, res);
    }

    // ── Step 3: Claude ranks and extracts the best 8 questions ────────────────
    const rawText = rawResults
      .slice(0, 24)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\n${r.snippet}`)
      .join('\n\n');

    const rankPrompt = `You are a content strategist. Below are real search results and forum posts about "${niche}".

SEARCH RESULTS:
${rawText}

${intel ? `OFFER AND AUDIENCE CONTEXT:\n${intel}\n\n` : ''}

Extract or derive the 8 best questions from this data — questions real people are genuinely asking about "${niche}". These should be:
1. Specific — not vague ("how do I make money" is too broad; "how do I make money with affiliate marketing without showing my face" is good)
2. Answerable — the person with this offer can answer them with real authority
3. Varied — mix of beginner questions, how-to questions, and "is it worth it" questions
4. Funnel-aligned — questions where the answer naturally leads toward the offer

Return ONLY valid JSON. No markdown, no explanation:
[
  {"question":"...","platform":"reddit|quora|google","volume":"high|medium","intent":"informational|commercial","why":"one sentence on why this question fits their offer"}
]`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: rankPrompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const rawOutput  = (claudeData.content || []).map(b => b.text || '').join('').trim();
    const clean      = rawOutput.replace(/```json|```/g, '').trim();
    const match      = clean.match(/\[[\s\S]*\]/);

    if (!match) return await fallbackGenerate(niche, intel, mode, CLAUDE_KEY, res);

    const questions = JSON.parse(match[0]);
    return res.status(200).json({ questions, source: 'live', total: questions.length });

  } catch (err) {
    console.error('[vpe-questions] Error:', err);
    // Always try fallback rather than returning an error
    return await fallbackGenerate(niche, intel, mode, CLAUDE_KEY, res);
  }
};

// ── Fallback: Claude generates from training knowledge ────────────────────────
async function fallbackGenerate(niche, intel, mode, CLAUDE_KEY, res) {
  try {
    const prompt = `You are a content strategist with deep knowledge of Reddit, Quora, Google and online forums.

Generate the 8 most commonly asked, highest-intent questions in the "${niche}" niche — questions real people genuinely ask every day on Reddit, Quora, Google and YouTube.

${intel ? `Offer and audience context:\n${intel}\n\n` : ''}

Rules:
- Specific and real — not invented generic questions
- Mix of informational (how/why/what) and commercial intent (best/should I/worth it)
- Questions the person with this offer can answer with genuine authority
- Each question should naturally lead toward their offer as part of the answer

Return ONLY valid JSON. No markdown, no explanation:
[
  {"question":"...","platform":"reddit|quora|google","volume":"high|medium","intent":"informational|commercial","why":"one sentence on why this fits their offer"}
]`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data   = await resp.json();
    const raw    = (data.content || []).map(b => b.text || '').join('').trim();
    const clean  = raw.replace(/```json|```/g, '').trim();
    const match  = clean.match(/\[[\s\S]*\]/);
    const questions = match ? JSON.parse(match[0]) : [];

    return res.status(200).json({ questions, source: 'generated', total: questions.length });
  } catch (e) {
    return res.status(500).json({ error: 'Could not generate questions', questions: [] });
  }
}
