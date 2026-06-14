// api/vpe-questions.js
// Real-time question discovery for the Value Post Engine
// Pulls from Reddit, Quora, Google, YouTube and X via Tavily
// Questions are ranked by Claude for post-worthiness

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { niche, intel, mode, keyword, isKeyword, exclude = [], page = 1 } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche is required' });

  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const currentYear = new Date().getFullYear();
  const searchTerm  = keyword || niche;

  try {
    let searches;

    if (isKeyword) {
      // ── KEYWORD MODE ──────────────────────────────────────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" review OR problem OR help OR how OR question OR issue`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}"`, tag: 'quora' },
        { query: `"${searchTerm}" how to OR "is it worth" OR "does it work" OR "vs" OR alternatives ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" beginners guide getting started problems mistakes ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" review tutorial how to ${currentYear}`, tag: 'youtube' },
        { query: `"${searchTerm}" site:x.com OR site:twitter.com ${currentYear}`, tag: 'x' },
      ];
    } else {
      // ── NICHE MODE ────────────────────────────────────────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" question help struggling ${currentYear}`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}" how why what ${currentYear}`, tag: 'quora' },
        { query: `"${searchTerm}" how to start results proof stuck ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" is it worth it saturated too late compete ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" ${currentYear} how to beginners mistakes`, tag: 'youtube' },
        { query: `"${searchTerm}" site:x.com OR site:twitter.com question struggle ${currentYear}`, tag: 'x' },
      ];
    }

    // ── Run all Tavily searches in parallel ───────────────────────────────────
    const tavilyResults = await Promise.allSettled(
      searches.map(s =>
        fetch('https://api.tavily.com/search', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key:             TAVILY_KEY,
            query:               s.query,
            search_depth:        'advanced',
            topic:               'general',
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

    // ── Extract results ───────────────────────────────────────────────────────
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
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche);
    }

    // ── Claude ranks and extracts the best questions ──────────────────────────
    const rawText = rawResults
      .slice(0, 30)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
      .join('\n\n');

    const excludeText = exclude.length > 0
      ? `\n\nDO NOT return questions similar to these already shown:\n${exclude.slice(0, 10).map((q, i) => `${i+1}. ${q}`).join('\n')}`
      : '';

    const rankPrompt = `You are a content strategist helping experts create high-performing social media posts.

NICHE: "${niche}"
${intel ? `OFFER AND AUDIENCE:\n${intel}\n` : ''}
SEARCH RESULTS:
${rawText}
${excludeText}

Extract the 8 BEST questions for writing sharp, authoritative posts. Each question must:

1. Be specific enough to take a clear position — not vague
2. Have a wrong popular belief most people hold that the expert can correct
3. Resonate with a large segment of the target audience
4. Lead naturally toward the expert's offer as the solution
5. Have a non-obvious insight available

GOOD questions:
- "Isn't [niche] completely saturated now — am I too late?"
- "Why do most people fail at [specific thing] even when they work hard?"
- "How do I scale past [milestone] without working more hours?"
- "Is [common approach] actually worth it or just hype?"

BAD questions (reject):
- "How do I grow my business?" (too vague)
- "What is [basic concept]?" (no position available)

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "https://...",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position the expert can take and why this builds authority",
    "wrong_belief": "one sentence: what most people wrongly believe about this"
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
        max_tokens: 1800,
        messages:   [{ role: 'user', content: rankPrompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const rawOutput  = (claudeData.content || []).map(b => b.text || '').join('').trim();
    const clean      = rawOutput.replace(/```json|```/g, '').trim();
    const match      = clean.match(/\[[\s\S]*\]/);

    if (!match) return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche);

    const questions = JSON.parse(match[0]);
    return res.status(200).json({ questions, source: 'live', total: questions.length });

  } catch (err) {
    console.error('[vpe-questions] Error:', err.message);
    return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche);
  }
}

// ── Fallback: Claude generates from training knowledge ────────────────────────
async function fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche) {
  const currentYear = new Date().getFullYear();
  try {
    const prompt = `Generate the 8 best questions someone could write a sharp, authoritative social media post about in the "${niche}" space.

${isKeyword ? `Questions must be specifically about: "${searchTerm}"` : `Questions must be relevant to: "${searchTerm}"`}

${intel ? `Offer and audience context:\n${intel}\n` : ''}

Each question must:
1. Be specific enough to take a clear position
2. Have a wrong popular belief most people hold
3. Have mass appeal in this niche
4. Lead naturally toward the expert's offer
5. Have a non-obvious insight available

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position the expert can take",
    "wrong_belief": "one sentence: what most people wrongly believe"
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
        max_tokens: 1400,
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
