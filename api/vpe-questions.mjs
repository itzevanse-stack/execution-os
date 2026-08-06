// api/vpe-questions.mjs
// Real-time question discovery for the Value Post Engine
// Sources: Google, YouTube, Bing, Amazon Suggest (all free, no key) + Tavily (live web)
// + optional AnswerThePublic (TikTok/Instagram/ChatGPT/Gemini, requires ATP_API_TOKEN) + Claude ranking

import { getATPQuestions } from './vpe-atp.mjs';

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

  // Browser-like headers — Google/Bing/Amazon's consumer suggest endpoints are
  // built for real browsers and frequently silently reject or empty-response
  // requests from datacenter IPs (like Vercel's) that show no User-Agent.
  const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json,text/javascript,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const searchTerm = keyword || cleanSearchTerm(niche);
  const seedPrefixes = (seed) => [
    seed,
    `why ${seed}`,
    `how to ${seed}`,
    `is ${seed} worth it`,
    `${seed} for beginners`,
    `${seed} mistakes`,
  ];

  // ── SOURCE 1: Google Suggest — free, no API key, real searches people type ──
  async function getGoogleSuggestions(seed) {
    const results = await Promise.allSettled(
      seedPrefixes(seed).map(q =>
        fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`, { headers: BROWSER_HEADERS })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then(d => (Array.isArray(d[1]) ? d[1] : []))
      )
    );
    const all = [];
    let failures = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) {
          if (typeof s === 'string' && s.length > 8 && !all.includes(s)) all.push(s);
        }
      } else {
        failures++;
      }
    }
    if (failures) console.warn(`[vpe-questions] Google Suggest: ${failures}/${results.length} requests failed. Last error:`, results.find(r => r.status === 'rejected')?.reason?.message);
    if (!all.length) console.warn('[vpe-questions] Google Suggest returned zero results for:', seed);
    return all.slice(0, 30);
  }

  // ── SOURCE 2: YouTube Suggest — same infra as Google, different client param ──
  // Surfaces what people search for when looking for VIDEO content — often more
  // pain/tutorial-driven phrasing than plain web search.
  async function getYouTubeSuggestions(seed) {
    const seeds = [seed, `${seed} tutorial`, `${seed} for beginners`, `is ${seed} worth it`, `${seed} explained`];
    const results = await Promise.allSettled(
      seeds.map(q =>
        fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`, { headers: BROWSER_HEADERS })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then(d => (Array.isArray(d[1]) ? d[1] : []))
      )
    );
    const all = [];
    let failures = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) {
          if (typeof s === 'string' && s.length > 8 && !all.includes(s)) all.push(s);
        }
      } else {
        failures++;
      }
    }
    if (failures) console.warn(`[vpe-questions] YouTube Suggest: ${failures}/${results.length} requests failed. Last error:`, results.find(r => r.status === 'rejected')?.reason?.message);
    if (!all.length) console.warn('[vpe-questions] YouTube Suggest returned zero results for:', seed);
    return all.slice(0, 20);
  }

  // ── SOURCE 3: Bing Suggest — free, no key, same endpoint Firefox itself uses ──
  async function getBingSuggestions(seed) {
    const results = await Promise.allSettled(
      seedPrefixes(seed).slice(0, 4).map(q =>
        fetch(`https://www.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&form=OSDJAS`, { headers: BROWSER_HEADERS })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then(d => (Array.isArray(d[1]) ? d[1] : []))
      )
    );
    const all = [];
    let failures = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) {
          if (typeof s === 'string' && s.length > 8 && !all.includes(s)) all.push(s);
        }
      } else {
        failures++;
      }
    }
    if (failures) console.warn(`[vpe-questions] Bing Suggest: ${failures}/${results.length} requests failed. Last error:`, results.find(r => r.status === 'rejected')?.reason?.message);
    if (!all.length) console.warn('[vpe-questions] Bing Suggest returned zero results for:', seed);
    return all.slice(0, 20);
  }

  // ── SOURCE 4: Amazon Suggest — free, no key — surfaces BUYER intent phrasing ──
  // Only useful if the niche has a physical/digital product angle; harmless no-op otherwise.
  async function getAmazonSuggestions(seed) {
    try {
      const r = await fetch(`https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(seed)}`, { headers: BROWSER_HEADERS });
      if (!r.ok) { console.warn(`[vpe-questions] Amazon Suggest HTTP ${r.status} for:`, seed); return []; }
      const d = await r.json();
      const sugs = (d.suggestions || []).map(s => s.value).filter(v => typeof v === 'string' && v.length > 3);
      if (!sugs.length) console.warn('[vpe-questions] Amazon Suggest returned zero results for:', seed);
      return sugs.slice(0, 15);
    } catch (e) {
      console.warn('[vpe-questions] Amazon Suggest error:', e.message);
      return [];
    }
  }

  // ── SOURCE 5: Tavily — live forum/blog/YouTube/Reddit results ──────────────
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
        .then(async r => {
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
          }
          return r.json();
        })
        .then(d => ({ ...d, _tag: s.tag }))
      )
    );

    const rawResults = [];
    let failures = 0;
    for (const result of tavilyResults) {
      if (result.status !== 'fulfilled') { failures++; continue; }
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
    if (failures) console.warn(`[vpe-questions] Tavily: ${failures}/${tavilyResults.length} searches failed. Last error:`, tavilyResults.find(r => r.status === 'rejected')?.reason?.message);
    if (!rawResults.length) console.warn('[vpe-questions] Tavily returned zero usable results for:', searchTerm);
    return rawResults;
  }

  try {
    // Run every source in parallel — no source blocks another
    const [googleSug, youtubeSug, bingSug, amazonSug, tavilyResults, atpResult] = await Promise.all([
      getGoogleSuggestions(searchTerm),
      getYouTubeSuggestions(searchTerm),
      getBingSuggestions(searchTerm),
      getAmazonSuggestions(searchTerm),
      getTavilyResults(searchTerm, isKeyword),
      getATPQuestions(searchTerm), // optional — no-ops cleanly if ATP_API_TOKEN unset
    ]);
    const atpQuestions = atpResult.questions || [];
    const hasATP = atpQuestions.length > 0;

    const hasTavily = tavilyResults.length > 0;
    const hasGoogle  = googleSug.length  > 0;
    const hasYoutube = youtubeSug.length > 0;
    const hasBing    = bingSug.length    > 0;
    const hasAmazon  = amazonSug.length  > 0;
    const hasAnySuggest = hasGoogle || hasYoutube || hasBing || hasAmazon;

    if (!hasTavily && !hasAnySuggest) {
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, currentYear);
    }

    const excludeText = exclude.length > 0
      ? `\n\nDO NOT return questions similar to:\n${exclude.slice(0, 10).map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

    // Each suggest source gets its own labelled section so Claude can attribute
    // and diversify the final picks across real platforms, not just Google.
    function suggestSection(label, list, prefix) {
      if (!list.length) return '';
      return `\n\n${label} — real queries people type there right now for "${searchTerm}":\n${list.map((s, i) => `[${prefix}${i}] ${s}`).join('\n')}\n`;
    }

    const googleSection  = suggestSection('GOOGLE AUTOCOMPLETE',  googleSug,  'G');
    const youtubeSection = suggestSection('YOUTUBE AUTOCOMPLETE', youtubeSug, 'Y');
    const bingSection    = suggestSection('BING AUTOCOMPLETE',    bingSug,    'B');
    const amazonSection  = suggestSection('AMAZON AUTOCOMPLETE (buyer-intent phrasing)', amazonSug, 'A');
    const atpSection = hasATP
      ? `\n\nANSWERTHEPUBLIC — real questions from TikTok/Instagram/ChatGPT/Gemini search behavior for "${searchTerm}":\n${atpQuestions.slice(0, 25).map((q, i) => `[P${i}][${(q.provider||'').toUpperCase()}] ${q.question}`).join('\n')}\n`
      : '';
    const tavilySection  = hasTavily
      ? `\n\nLIVE WEB RESULTS — Reddit, Quora, YouTube, forums (index, platform, year, title, url, snippet):\n${tavilyResults.slice(0, 30).map((r, i) => `[T${i}][${r.tag.toUpperCase()}][${r.year}] ${r.title}\nURL: ${r.url}\n${r.snippet.slice(0, 180)}`).join('\n\n')}\n`
      : '';

    const rankPrompt = `You are a content strategist helping experts write high-performing social media posts that attract paying clients.

NICHE: "${niche}"
${intel ? `OFFER AND AUDIENCE:\n${intel}\n` : ''}
${googleSection}${youtubeSection}${bingSection}${amazonSection}${atpSection}${tavilySection}
${excludeText}

Extract the 8 BEST questions for writing sharp, authoritative posts that drive real business results.

SOURCE DIVERSITY IS REQUIRED — do not pull all 8 from one source. Draw from across Google, YouTube, Bing, Amazon (if relevant), and the live Reddit/Quora/forum results. A good mix is roughly 2-3 from search autocomplete sources and 2-3 from the live Reddit/Quora/forum results, reflecting genuinely different angles people search from.

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
- Autocomplete phrases are real search queries — use them as raw material, then sharpen into a compelling question if needed
- For Tavily results, the "index" field must be T+number (e.g. T0, T3). The "url" and "year" MUST come from that source.
- For autocomplete sources (Google/YouTube/Bing/Amazon/ATP), set url to "" and year to "${currentYear}", and set "index" to the matching prefix+number (e.g. G3, Y1, B0, A2, P4)
- Rewrite vague titles into sharp questions the expert can take a clear position on
- Never copy a Reddit thread title verbatim

Return ONLY valid JSON — no markdown fences:
[
  {
    "question": "sharp, specific question as a serious buyer would phrase it",
    "platform": "reddit|quora|google|youtube|bing|amazon|tiktok|instagram|chatgpt|gemini|x",
    "source": "google_suggest|youtube_suggest|bing_suggest|amazon_suggest|tavily",
    "url": "exact url from Tavily source, or empty string for autocomplete sources",
    "year": "${currentYear}",
    "volume": "high|medium",
    "intent": "informational|commercial",
    "why": "one sentence: what position the expert takes and why this builds authority",
    "wrong_belief": "one sentence: what most people wrongly believe about this",
    "index": "T0, G3, Y1, B0, A2 etc"
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

    const activeSources = ['google','youtube','bing','amazon','atp']
      .filter((_, i) => [hasGoogle, hasYoutube, hasBing, hasAmazon, hasATP][i]);
    const source = (activeSources.length ? 'live+' + activeSources.join('+') : 'live');
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
