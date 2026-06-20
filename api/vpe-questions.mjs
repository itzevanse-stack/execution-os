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

  // Long descriptive niche strings (e.g. "Digital Products and Info Business
  // — High-Ticket Affiliate Partnership") return zero results when quoted
  // verbatim in search — nobody types that exact sentence anywhere. Extract
  // a clean, short core term before it's used to build search queries.
  // Strategy: take text before any em-dash/colon (the category, not the
  // specific positioning), then cap to the first ~4 meaningful words.
  function cleanSearchTerm(raw) {
    if (!raw) return raw;
    let t = String(raw).split(/[—–\-:]/)[0].trim(); // before dash/colon
    t = t.replace(/\b(and|the|a|an|for|with|of|in|to)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const words = t.split(' ').filter(Boolean);
    return words.slice(0, 4).join(' ') || raw;
  }

  const searchTerm  = keyword || cleanSearchTerm(niche);

  try {
    let searches;

    if (isKeyword) {
      // ── KEYWORD MODE ──────────────────────────────────────────────────────
      searches = [
        { query: `"${searchTerm}" is it worth it how does it work results ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" mistakes beginners make truth nobody tells you ${currentYear}`, tag: 'google' },
        { query: `site:quora.com "${searchTerm}" how why what should I`, tag: 'quora' },
        { query: `site:youtube.com "${searchTerm}" honest review worth it ${currentYear}`, tag: 'youtube' },
        { query: `site:reddit.com/r/entrepreneur OR site:reddit.com/r/digitalmarketing OR site:reddit.com/r/passive_income "${searchTerm}"`, tag: 'reddit' },
        { query: `site:reddit.com/r/affiliatemarketing OR site:reddit.com/r/Entrepreneur OR site:reddit.com/r/sidehustle "${searchTerm}" how OR why OR worth OR should`, tag: 'reddit' },
        { query: `"${searchTerm}" site:x.com (is it worth OR does it work OR how do I OR why does) ${currentYear}`, tag: 'x' },
        { query: `"${searchTerm}" site:medium.com OR site:linkedin.com ${currentYear}`, tag: 'web' },
      ];
    } else {
      // ── NICHE MODE ────────────────────────────────────────────────────────
      searches = [
        { query: `"${searchTerm}" is it saturated worth starting why people fail ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" honest truth what nobody tells you how to scale ${currentYear}`, tag: 'google' },
        { query: `site:quora.com "${searchTerm}" how why what should I ${currentYear}`, tag: 'quora' },
        { query: `site:youtube.com "${searchTerm}" mistakes beginners make ${currentYear}`, tag: 'youtube' },
        { query: `site:reddit.com/r/entrepreneur OR site:reddit.com/r/digitalmarketing OR site:reddit.com/r/passive_income "${searchTerm}" how OR why OR worth OR should`, tag: 'reddit' },
        { query: `site:reddit.com/r/affiliatemarketing OR site:reddit.com/r/sidehustle OR site:reddit.com/r/personalfinance "${searchTerm}"`, tag: 'reddit' },
        { query: `"${searchTerm}" site:x.com (is it worth OR does it work OR how do I OR why) ${currentYear}`, tag: 'x' },
        { query: `"${searchTerm}" site:medium.com OR site:linkedin.com OR site:forbes.com ${currentYear}`, tag: 'web' },
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

GOOD questions (sharp, specific, position-taking):
- "Isn't the digital product space completely saturated in 2026?"
- "Why do most people fail at affiliate marketing even when they follow all the steps?"
- "How do I scale past $20K/month without working more hours?"
- "Is buying a digital product course actually worth it or just a waste of money?"
- "Do you actually need a big audience to make $10K/month selling digital products?"

BAD questions (reject these completely):
- "How do I grow my business?" — too vague, no position
- "What is affiliate marketing?" — basic definition, no insight
- "How do I make money online?" — too broad
- Any question that reads like a Reddit thread title
- Any question with casual or slang language
- Any question that can't be answered with a sharp contrarian take

STRICT RULES:
- Questions must sound like something a serious buyer would Google
- Every question must have an obvious wrong belief most people hold
- Rewrite vague titles into sharp questions if needed
- Do not use the source title verbatim — extract the real question behind it

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
    if (!match) {
      console.error('[vpe-questions] Fallback returned no parseable JSON. Raw output:', raw.slice(0, 300));
    }
    const questions = match ? JSON.parse(match[0]) : [];

    return res.status(200).json({ questions, source: 'generated', total: questions.length });
  } catch (e) {
    return res.status(500).json({ error: 'Could not generate questions', questions: [] });
  }
}
