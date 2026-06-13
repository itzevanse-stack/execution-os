// api/vpe-questions.js
// Real-time question discovery for the Value Post Engine
// Two modes:
//   - Niche mode: broad audience question discovery for their niche
//   - Keyword mode: specific questions about an exact keyword/product/topic
//
// Quality standard: questions must be specific enough to write a sharp,
// position-taking post with real proof — not generic enough to produce
// vague content that could apply to anyone.

export default async function handler(req, res) {
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
      searches = [
        { query: `site:reddit.com "${searchTerm}" review OR problem OR help OR how OR question OR issue`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}"`, tag: 'quora' },
        { query: `"${searchTerm}" how to OR "is it worth" OR "does it work" OR "vs" OR "alternatives" ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" beginners guide tutorial getting started problems ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" review tutorial how to ${currentYear}`, tag: 'youtube' },
        { query: `"${searchTerm}" site:twitter.com OR site:x.com (${previousYear} OR ${currentYear})`, tag: 'x' },
      ];
    } else {
      // ── NICHE MODE — broad audience question discovery ────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" question help struggling (${previousYear} OR ${currentYear})`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}" how why what (${previousYear} OR ${currentYear})`, tag: 'quora' },
        { query: `"${searchTerm}" how to start results proof stuck ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" is it worth it saturated too late compete ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" ${currentYear} how to beginners mistakes`, tag: 'youtube' },
        { query: `"${searchTerm}" site:x.com OR site:twitter.com question struggle ${currentYear}`, tag: 'x' },
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
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche);
    }

    // ── Claude extracts and ranks questions by post-worthiness ────────────────
    const rawText = rawResults
      .slice(0, 30)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
      .join('\n\n');

    const rankPrompt = `You are a content strategist who helps experts in the "${niche}" space create high-performing social media posts.

Below are real search results. Your job is to extract the 8 BEST questions for writing sharp, authoritative posts.

SEARCH RESULTS:
${rawText}

${intel ? `OFFER AND AUDIENCE CONTEXT:\n${intel}\n\n` : ''}

SELECTION CRITERIA — only pick questions that meet ALL of these:

1. SPECIFIC ENOUGH TO TAKE A POSITION — the question must be debatable or have a non-obvious answer. Good: "Is the digital product space too saturated in 2026?" Bad: "How do I grow online?"

2. COMMON ENOUGH TO MATTER — real people are actually asking this, not just one person. It should resonate with a large segment of the target audience.

3. HAS A WRONG POPULAR ANSWER — most people believe the wrong thing about this. The expert can write a post that names the wrong belief and corrects it with real experience.

4. LEADS NATURALLY TO THE OFFER — answering this question positions the expert as the solution. The answer should naturally create demand for what they sell.

5. NOT TOO BROAD — reject questions like "How do I make money online?" or "What is digital marketing?" Too vague to write a sharp post about.

6. NOT TOO NARROW — reject questions that only 5 people would ask. Needs mass appeal.

EXAMPLES OF GOOD QUESTIONS for digital product / coaching space:
- "Isn't the digital product space completely saturated now?" (debatable, common belief, wrong answer most people give)
- "How do I scale past $20K/month without working more hours?" (specific problem, large audience, leads to systems/offer)
- "Why do most people fail at [specific thing] even when they work hard?" (names the enemy, strong position available)
- "Is [specific method/tool] actually worth it or just hype?" (commercial intent, comparison opportunity)

Return the source URL from the results above for each question.

Return ONLY valid JSON. No markdown. No explanation:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "https://...",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position can the expert take and why does answering this build their authority",
    "wrong_belief": "one sentence: what does most people wrongly believe about this that the expert can correct"
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

${isKeyword ? `The questions must be specifically about: "${searchTerm}"` : `The questions must be relevant to: "${searchTerm}"`}

${intel ? `Offer and audience context:\n${intel}\n\n` : ''}

QUALITY STANDARD — every question must meet all of these:
1. Specific enough that an expert can take a clear position — not vague
2. Has a common WRONG belief most people hold — the expert can correct it
3. Large enough audience — many people in this niche are asking this
4. Leads naturally toward the expert's offer as the solution
5. Has non-obvious insight available — not something Google already answers perfectly

EXAMPLES OF GOOD QUESTIONS:
- "Isn't [niche] completely saturated now — am I too late?"
- "Why do most people in [niche] fail even when they work really hard?"
- "How do I scale past [specific milestone] without working more hours?"
- "Is [common approach/tool] actually worth it or just hype?"
- "What's the real reason [specific common problem] keeps happening?"

BAD QUESTIONS (reject these):
- "How do I grow my business?" (too vague)
- "What is [basic concept]?" (too educational, no position available)
- "Should I start a business?" (wrong audience)

Return ONLY valid JSON. No markdown:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "url": "",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position can the expert take and why does answering this build authority",
    "wrong_belief": "one sentence: what does most people wrongly believe about this"
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
