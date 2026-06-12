// api/vpe-questions.js
// Real-time question discovery for the Value Post Engine
// Two modes:
//   - Niche mode (isKeyword: false): broad audience question discovery for their niche
//   - Keyword mode (isKeyword: true): specific questions about an exact keyword/product/topic

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { niche, intel, mode, keyword, isKeyword } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche is required' });

  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const currentYear  = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const searchTerm   = keyword || niche;

  try {
    let searches;

    if (isKeyword) {
      // ── KEYWORD MODE — surgical search for questions about a specific term ──
      // These queries are designed to surface actual questions people ask, not
      // generic content about the topic
      searches = [
        // Reddit threads where people ask questions about this keyword
        {
          query: `site:reddit.com "${searchTerm}" review OR problem OR help OR how OR question OR issue`,
          tag:   'reddit',
        },
        // Quora questions specifically about this keyword
        {
          query: `site:quora.com "${searchTerm}"`,
          tag:   'quora',
        },
        // Google "People Also Ask" style — questions people type
        {
          query: `"${searchTerm}" how to OR "is it worth" OR "does it work" OR "vs" OR "alternatives" ${currentYear}`,
          tag:   'google',
        },
        // Beginner and getting-started questions
        {
          query: `"${searchTerm}" beginners guide tutorial getting started problems ${currentYear}`,
          tag:   'google',
        },
        // YouTube — what videos people watch about this keyword
        {
          query: `site:youtube.com "${searchTerm}" review tutorial how to ${currentYear}`,
          tag:   'youtube',
        },
        // X/Twitter — real-time discussions and complaints
        {
          query: `"${searchTerm}" site:twitter.com OR site:x.com (${previousYear} OR ${currentYear})`,
          tag:   'x',
        },
      ];
    } else {
      // ── NICHE MODE — broad audience question discovery ────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" (${previousYear} OR ${currentYear})`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}" (${previousYear} OR ${currentYear})`,  tag: 'quora' },
        { query: `"${searchTerm}" how to questions beginners ${currentYear}`,            tag: 'google' },
        { query: `"${searchTerm}" best worth it results proof ${currentYear}`,           tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" ${currentYear} beginners guide how to`, tag: 'youtube' },
        { query: `site:twitter.com OR site:x.com "${searchTerm}" ${currentYear} how question`, tag: 'x' },
      ];
    }

    // ── Run all searches in parallel ──────────────────────────────────────────
    const tavilyResults = await Promise.allSettled(
      searches.map(s =>
        fetch('https://api.tavily.com/search', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key:             TAVILY_KEY,
            query:               s.query,
            search_depth:        'advanced',
            max_results:         5,
            include_answer:      false,
            include_raw_content: false,
          }),
        })
        .then(r => r.json())
        .then(d => ({ ...d, _tag: s.tag }))
        .catch(() => ({ _tag: s.tag, results: [] }))
      )
    );

    // ── Extract results with URLs ─────────────────────────────────────────────
    const rawResults = [];
    for (const result of tavilyResults) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      const tag  = data._tag || 'web';
      if (!data.results) continue;
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

    if (rawResults.length === 0) {
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword);
    }

    // ── Claude extracts and ranks real questions ──────────────────────────────
    const rawText = rawResults
      .slice(0, 30)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
      .join('\n\n');

    const rankPrompt = isKeyword
      ? `You are a content researcher. Below are real search results about "${searchTerm}" from Reddit, Quora, Google, YouTube and X.

SEARCH RESULTS:
${rawText}

${intel ? `CONTEXT:\n${intel}\n\n` : ''}

Extract the 8 best SPECIFIC QUESTIONS that real people are asking about "${searchTerm}" from these results.

Requirements:
1. Questions must be SPECIFICALLY about "${searchTerm}" — not generic
2. Must be real questions people genuinely ask — complaints, how-tos, comparisons, "is it worth it", pricing, problems
3. Include the source URL from the results above
4. VARIED — mix of beginner, comparison, troubleshooting, results-focused questions
5. Each question should be something someone could write a helpful post answering

Examples of good questions for "systeme.io":
- "Is systeme.io actually free or are there hidden costs?"
- "Can systeme.io replace ClickFunnels for my coaching business?"
- "Why are my systeme.io emails going to spam?"

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "https://...",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence on why answering this drives traffic"
  }
]`
      : `You are a content strategist. Below are real search results about "${searchTerm}" from the last 12 months.

SEARCH RESULTS:
${rawText}

${intel ? `OFFER AND AUDIENCE CONTEXT:\n${intel}\n\n` : ''}

Extract the 8 best questions real people are asking about "${searchTerm}" right now.

Requirements:
1. SPECIFIC — not vague
2. RECENT — from the results above, not old evergreen content
3. ANSWERABLE — someone with expertise in this niche can answer authoritatively
4. FUNNEL-ALIGNED — the answer naturally leads toward an offer
5. VARIED — mix of beginner, how-to, and "is it worth it" questions

Return the most relevant source URL for each question.

Return ONLY valid JSON. No markdown:
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

    if (!match) return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword);

    const questions = JSON.parse(match[0]);
    return res.status(200).json({ questions, source: 'live', total: questions.length });

  } catch (err) {
    console.error('[vpe-questions] Error:', err.message);
    return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword);
  }
};

// ── Fallback: Claude generates from training knowledge ────────────────────────
async function fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword) {
  const currentYear = new Date().getFullYear();
  try {
    const prompt = isKeyword
      ? `Generate the 8 most specific and commonly asked questions that people ask about "${searchTerm}" in ${currentYear}.

These should be questions real people genuinely type into Google, Reddit, Quora or YouTube about "${searchTerm}" specifically.

Include a mix of:
- "Is ${searchTerm} worth it?" style questions
- "How do I [specific task] with ${searchTerm}?" questions
- Comparison questions: "${searchTerm} vs [alternative]?"
- Problem/troubleshooting questions
- Beginner questions
- Results/proof questions

${intel ? `Context:\n${intel}\n\n` : ''}

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence on why answering this drives traffic and leads"
  }
]`
      : `Generate the 8 most commonly asked, highest-intent questions about "${searchTerm}" that people are asking in ${currentYear}.

${intel ? `Offer and audience context:\n${intel}\n\n` : ''}

Rules:
- Specific, not vague
- Current — the kind of question being asked in ${currentYear}
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
