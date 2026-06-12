// api/vpe-questions.js
// Real-time question discovery for the Value Post Engine
// Sources: Reddit, Quora, Google PAA, YouTube, X/Twitter — last 12 months only
// Ranked and enriched by Claude for offer-relevance

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { niche, intel, mode } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche is required' });

  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Current year for recency
  const currentYear  = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const recencyNote  = `${previousYear} OR ${currentYear}`;

  try {
    // ── Multi-source searches in parallel ────────────────────────────────────
    const searches = [
      // Reddit — recent threads
      {
        query: `site:reddit.com "${niche}" (${recencyNote})`,
        tag:   'reddit',
      },
      // Quora — recent questions
      {
        query: `site:quora.com "${niche}" (${recencyNote})`,
        tag:   'quora',
      },
      // Google PAA / informational
      {
        query: `"${niche}" how to questions beginners ${currentYear}`,
        tag:   'google',
      },
      // Google commercial intent
      {
        query: `"${niche}" best worth it results proof ${currentYear}`,
        tag:   'google',
      },
      // YouTube — high-search video titles (proxy for what people want to know)
      {
        query: `site:youtube.com "${niche}" ${currentYear} beginners guide how to`,
        tag:   'youtube',
      },
      // X/Twitter — trending questions and discussions
      {
        query: `site:twitter.com OR site:x.com "${niche}" ${currentYear} how question`,
        tag:   'x',
      },
    ];

    const tavilyResults = await Promise.allSettled(
      searches.map(s =>
        fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key:            TAVILY_KEY,
            query:              s.query,
            search_depth:       'advanced',
            max_results:        5,
            include_answer:     false,
            include_raw_content: false,
          }),
        })
        .then(r => r.json())
        .then(d => ({ ...d, _tag: s.tag }))
      )
    );

    // ── Extract raw results with URLs ─────────────────────────────────────────
    const rawResults = [];
    for (const result of tavilyResults) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      const tag  = data._tag || 'web';
      if (data.results) {
        for (const r of data.results) {
          if (!r.title) continue;
          rawResults.push({
            title:   r.title,
            snippet: r.content || '',
            url:     r.url    || '',
            tag,
          });
        }
      }
    }

    if (rawResults.length === 0) {
      return await fallbackGenerate(niche, intel, CLAUDE_KEY, res);
    }

    // ── Claude ranks, extracts questions, returns URLs ────────────────────────
    const rawText = rawResults
      .slice(0, 30)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
      .join('\n\n');

    const rankPrompt = `You are a content strategist. Below are real search results from Reddit, Quora, Google, YouTube and X about "${niche}" from the last 12 months.

SEARCH RESULTS:
${rawText}

${intel ? `OFFER AND AUDIENCE CONTEXT:\n${intel}\n\n` : ''}

From this data, extract or derive the 8 best questions real people are asking about "${niche}" right now. Requirements:
1. SPECIFIC — not vague ("how do I make money with affiliate marketing without showing my face" not "how do I make money")
2. RECENT — from the search results above, not old evergreen questions
3. ANSWERABLE — the person with this offer can answer with genuine authority
4. FUNNEL-ALIGNED — the answer naturally leads toward the offer
5. VARIED — mix of beginner, how-to, and "is it worth it" questions

For each question, return the most relevant source URL from the search results above.

Return ONLY valid JSON. No markdown, no explanation:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "https://...",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence on why this fits their offer"
  }
]`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: rankPrompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const rawOutput  = (claudeData.content || []).map(b => b.text || '').join('').trim();
    const clean      = rawOutput.replace(/```json|```/g, '').trim();
    const match      = clean.match(/\[[\s\S]*\]/);

    if (!match) return await fallbackGenerate(niche, intel, CLAUDE_KEY, res);

    const questions = JSON.parse(match[0]);
    return res.status(200).json({ questions, source: 'live', total: questions.length });

  } catch (err) {
    console.error('[vpe-questions] Error:', err.message);
    return await fallbackGenerate(niche, intel, CLAUDE_KEY, res);
  }
};

// ── Fallback: Claude generates from training knowledge ────────────────────────
async function fallbackGenerate(niche, intel, CLAUDE_KEY, res) {
  const currentYear = new Date().getFullYear();
  try {
    const prompt = `You are a content strategist with deep knowledge of what people are searching for on Reddit, Quora, Google and YouTube.

Generate the 8 most commonly asked, highest-intent questions about "${niche}" that people are asking in ${currentYear}. These should be questions real people genuinely ask right now — not outdated evergreen questions.

${intel ? `Offer and audience context:\n${intel}\n\n` : ''}

Rules:
- Specific, not vague — include detail that reflects real searches
- Current — the kind of question being asked in ${currentYear}
- Answerable by someone with this offer with genuine authority
- Mix informational and commercial intent

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence on why this fits their offer"
  }
]`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data      = await resp.json();
    const raw       = (data.content || []).map(b => b.text || '').join('').trim();
    const clean     = raw.replace(/```json|```/g, '').trim();
    const match     = clean.match(/\[[\s\S]*\]/);
    const questions = match ? JSON.parse(match[0]) : [];

    return res.status(200).json({ questions, source: 'generated', total: questions.length });
  } catch (e) {
    return res.status(500).json({ error: 'Could not generate questions', questions: [] });
  }
}
