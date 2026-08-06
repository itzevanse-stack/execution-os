// api/vpe-questions.mjs
// Real-time question discovery for the Value Post Engine
// Sources: Google Suggest (free, no key) + Tavily (live web) + Claude ranking

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

  function cleanSearchTerm(raw) {
    if (!raw) return raw;
    let t = String(raw).split(/[—–\-:]/)[0].trim();
    t = t.replace(/\b(and|the|a|an|for|with|of|in|to)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').filter(Boolean).slice(0, 4).join(' ') || raw;
  }

  function extractYear(url, snippet) {
    const text = (url || '') + ' ' + (snippet || '');
    const matches = [...text.matchAll(/\b(202[0-9])\b/g)].map(m => m[1]);
    return matches.length ? matches.sort().pop() : String(currentYear);
  }

  const searchTerm = keyword || cleanSearchTerm(niche);

  // ── SOURCE 1: Google Suggest — free, no API key, real searches people type ──
  // Uses Google's autocomplete endpoint. Returns what real users are actually
  // searching right now, which is the highest-signal data for question discovery.
  async function getGoogleSuggestions(seed) {
    const seeds = [
      seed,
      `why ${seed}`,
      `how to ${seed}`,
      `is ${seed} worth it`,
      `${seed} for beginners`,
      `${seed} mistakes`,
    ];
    const results = await Promise.allSettled(
      seeds.map(q =>
        fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`)
          .then(r => r.json())
          .then(d => (Array.isArray(d[1]) ? d[1] : []))
          .catch(() => [])
      )
    );
    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) {
          if (typeof s === 'string' && s.length > 8 && !all.includes(s)) all.push(s);
        }
      }
    }
    return all.slice(0, 40); // top 40 unique suggestions
  }

  // ── SOURCE 2: Tavily — live forum/blog/YouTube/Reddit results ──────────────
  async function getTavilyResults(searchTerm, isKeyword) {
    const searches = isKeyword ? [
      { query: `"${searchTerm}" is it worth it how does it work results ${currentYear}`, tag: 'google' },
      { query: `"${searchTerm}" mistakes beginners make truth nobody tells you ${currentYear}`, tag: 'google' },
      { query: `site:quora.com "${searchTerm}" how why what should I`, tag: 'quora' },
      { query: `site:youtube.com "${searchTerm}" honest review worth it ${currentYear}`, tag: 'youtube' },
      { query: `site:reddit.com/r/entrepreneur OR site:reddit.com/r/digitalmarketing OR site:reddit.com/r/passive_income "${searchTerm}"`, tag: 'reddit' },
      { query: `site:reddit.com/r/affiliatemarketing OR site:reddit.com/r/Entrepreneur OR site:reddit.com/r/sidehustle "${searchTerm}" how OR why OR worth OR should`, tag: 'reddit' },
      { query: `"${searchTerm}" site:x.com (is it worth OR does it work OR how do I OR why does) ${currentYear}`, tag: 'x' },
      { query: `"${searchTerm}" site:medium.com OR site:linkedin.com ${currentYear}`, tag: 'web' },
    ] : [
      { query: `"${searchTerm}" is it saturated worth starting why people fail ${currentYear}`, tag: 'google' },
      { query: `"${searchTerm}" honest truth what nobody tells you how to scale ${currentYear}`, tag: 'google' },
      { query: `site:quora.com "${searchTerm}" how why what should I ${currentYear}`, tag: 'quora' },
      { query: `site:youtube.com "${searchTerm}" mistakes beginners make ${currentYear}`, tag: 'youtube' },
      { query: `site:reddit.com/r/entrepreneur OR site:reddit.com/r/digitalmarketing OR site:reddit.com/r/passive_income "${searchTerm}" how OR why OR worth OR should`, tag: 'reddit' },
      { query: `site:reddit.com/r/affiliatemarketing OR site:reddit.com/r/sidehustle OR site:reddit.com/r/personalfinance "${searchTerm}"`, tag: 'reddit' },
      { query: `"${searchTerm}" site:x.com (is it worth OR does it work OR how do I OR why) ${currentYear}`, tag: 'x' },
      { query: `"${searchTerm}" site:medium.com OR site:linkedin.com OR site:forbes.com ${currentYear}`, tag: 'web' },
    ];

    const tavilyResults = await Promise.allSettled(
      searches.map(s =>
        fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key:             TAVILY_KEY,
            query:               s.query,
            search_depth:        'advanced',
            topic:               'general',
            max_results:         5,
            days:                365,
            include_answer:      false,
            include_raw_content: false,
          }),
        })
        .then(r => r.json())
        .then(d => ({ ...d, _tag: s.tag }))
        .catch(() => ({ _tag: s.tag, results: [] }))
      )
    );

    const rawResults = [];
    for (const result of tavilyResults) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value;
      if (!Array.isArray(data.results)) continue;
      for (const r of data.results) {
        if (!r.title) continue;
        rawResults.push({
          title:   r.title,
          snippet: r.content || '',
          url:     r.url    || '',
          tag:     data._tag || 'web',
          year:    extractYear(r.url, r.content),
        });
      }
    }
    return rawResults;
  }

  try {
    // Run Google Suggest and Tavily in parallel — don't let one block the other
    const [googleSuggestions, tavilyResults] = await Promise.all([
      getGoogleSuggestions(searchTerm),
      getTavilyResults(searchTerm, isKeyword),
    ]);

    const hasTavily  = tavilyResults.length  > 0;
    const hasGoogle  = googleSuggestions.length > 0;

    if (!hasTavily && !hasGoogle) {
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, currentYear);
    }

    // ── Build the combined context for Claude ────────────────────────────────
    const excludeText = exclude.length > 0
      ? `\n\nDO NOT return questions similar to:\n${exclude.slice(0, 10).map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

    // Google Suggest section — these are exact phrases real people type
    const googleSection = hasGoogle
      ? `\n\nGOOGLE AUTOCOMPLETE — What real people are typing into Google right now about "${searchTerm}":\n${googleSuggestions.map((s, i) => `[G${i}] ${s}`).join('\n')}\n`
      : '';

    // Tavily section — live forum/blog/video results
    const tavilySection = hasTavily
      ? `\n\nLIVE WEB RESULTS — Reddit, Quora, YouTube, forums (index, platform, year, title, url, snippet):\n${tavilyResults.slice(0, 30).map((r, i) => `[T${i}][${r.tag.toUpperCase()}][${r.year}] ${r.title}\nURL: ${r.url}\n${r.snippet.slice(0, 180)}`).join('\n\n')}\n`
      : '';

    const rankPrompt = `You are a content strategist helping experts write high-performing social media posts that attract paying clients.

NICHE: "${niche}"
${intel ? `OFFER AND AUDIENCE:\n${intel}\n` : ''}
${googleSection}
${tavilySection}
${excludeText}

Extract the 8 BEST questions for writing sharp, authoritative posts that drive real business results.

PRIORITISE questions from Google Autocomplete — these are exactly what your audience types when they are in pain and looking for a solution. They are the highest-signal data available.

Each question must:
1. Be specific — a reader must feel "this is exactly my situation"
2. Have a widely-held wrong belief the expert can correct with authority
3. Lead naturally toward the expert's offer as the logical next step
4. Have a non-obvious insight the expert can deliver that most people miss

GREAT questions (sharp, specific, position-taking):
- "Is the digital product space completely saturated in ${currentYear}?"
- "Why do most people fail at affiliate marketing even when they follow all the steps?"
- "How do I get my first paying client with zero audience and zero testimonials?"

BAD questions (reject completely):
- "How do I grow my business?" — too vague
- "What is affiliate marketing?" — basic definition, no position
- Anything copied verbatim from a Reddit title without sharpening it

RULES:
- Questions from Google Autocomplete are real search queries — use them as the raw material, then sharpen into a compelling question if needed
- For Tavily results, the "index" field must be T+number (e.g. T0, T3). The "url" and "year" MUST come from that source.
- For Google Suggest sources, set url to "" and year to "${currentYear}"
- Rewrite vague titles into sharp questions the expert can take a clear position on
- Never copy a Reddit thread title verbatim

Return ONLY valid JSON — no markdown fences:
[
  {
    "question": "sharp, specific question as a serious buyer would phrase it",
    "platform": "reddit|quora|google|youtube|x",
    "source": "google_suggest|tavily",
    "url": "exact url from Tavily source, or empty string for Google Suggest",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position the expert takes and why this builds authority",
    "wrong_belief": "one sentence: what most people wrongly believe about this",
    "index": "T0 or G5 etc"
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

    if (!match) {
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, currentYear);
    }

    let questions = JSON.parse(match[0]);

    // Backfill url/year from Tavily results where index is T+number
    questions = questions.map(q => {
      let url  = q.url  || '';
      let year = q.year || String(currentYear);
      if (q.index && String(q.index).startsWith('T')) {
        const idx = parseInt(String(q.index).replace('T', ''), 10);
        const src = tavilyResults[idx];
        if (src) { url = src.url || url; year = src.year || year; }
      }
      return {
        question:    q.question    || '',
        platform:    q.platform    || 'google',
        source:      q.source      || 'tavily',
        url,
        year,
        volume:      q.volume      || 'medium',
        intent:      q.intent      || 'informational',
        why:         q.why         || '',
        wrong_belief: q.wrong_belief || '',
      };
    });

    const source = hasGoogle ? 'live+google' : 'live';
    return res.status(200).json({ questions, source, total: questions.length });

  } catch (err) {
    console.error('[vpe-questions] Error:', err.message);
    return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, currentYear);
  }
}

// ── Fallback: Claude generates from training knowledge ──────────────────────
async function fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, currentYear) {
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

Return ONLY valid JSON — no markdown fences:
[
  {
    "question": "...",
    "platform": "reddit|quora|google|youtube|x",
    "source": "generated",
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
    console.error('[vpe-questions] Fallback error:', e.message);
    return res.status(500).json({ error: 'Could not generate questions', questions: [] });
  }
}
