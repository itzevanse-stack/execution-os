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

  const { niche, intel, mode, keyword, isKeyword, exclude = [], page = 1, country = '' } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche is required' });

  const TAVILY_KEY  = process.env.TAVILY_API_KEY;
  const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY;
  const SERPAPI_KEY = process.env.SERPAPI_KEY;

  if (!TAVILY_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const currentYear  = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const searchTerm   = keyword || niche;

  // ── Country-specific search modifiers ────────────────────────────────────
  const countryModifiers = {
    'Nigeria':              { terms: 'Nigeria Nigerian naira NGN', reddit: 'r/Nigeria r/nairaland', forums: 'nairaland.com' },
    'South Africa':         { terms: 'South Africa South African ZAR rand', reddit: 'r/southafrica r/ZAspending', forums: 'mybroadband.co.za' },
    'Kenya':                { terms: 'Kenya Kenyan KES shilling Mpesa', reddit: 'r/Kenya', forums: '' },
    'Ghana':                { terms: 'Ghana Ghanaian GHS cedi', reddit: 'r/ghana', forums: '' },
    'Egypt':                { terms: 'Egypt Egyptian EGP pound', reddit: 'r/egypt', forums: '' },
    'Ethiopia':             { terms: 'Ethiopia Ethiopian ETB birr', reddit: 'r/Ethiopia', forums: '' },
    'Tanzania':             { terms: 'Tanzania Tanzanian TZS', reddit: 'r/Tanzania', forums: '' },
    'Uganda':               { terms: 'Uganda Ugandan UGX', reddit: 'r/Uganda', forums: '' },
    'Rwanda':               { terms: 'Rwanda Rwandan RWF', reddit: 'r/Rwanda', forums: '' },
    'Cameroon':             { terms: 'Cameroon Cameroonian FCFA', reddit: 'r/cameroon', forums: '' },
    'United States':        { terms: 'USA American USD dollars', reddit: 'r/personalfinance r/entrepreneur r/smallbusiness', forums: '' },
    'Canada':               { terms: 'Canada Canadian CAD', reddit: 'r/PersonalFinanceCanada r/canada r/canadiansmallbusiness', forums: '' },
    'Mexico':               { terms: 'Mexico Mexican MXN pesos', reddit: 'r/mexico', forums: '' },
    'United Kingdom':       { terms: 'UK British GBP pounds sterling', reddit: 'r/UKPersonalFinance r/unitedkingdom r/AskUK', forums: '' },
    'Germany':              { terms: 'Germany German EUR euro', reddit: 'r/germany r/finanzen', forums: '' },
    'France':               { terms: 'France French EUR euro', reddit: 'r/france r/vosfinances', forums: '' },
    'Netherlands':          { terms: 'Netherlands Dutch EUR euro', reddit: 'r/Netherlands r/thenetherlands', forums: '' },
    'Spain':                { terms: 'Spain Spanish EUR euro', reddit: 'r/spain', forums: '' },
    'Italy':                { terms: 'Italy Italian EUR euro', reddit: 'r/italy', forums: '' },
    'Sweden':               { terms: 'Sweden Swedish SEK krona', reddit: 'r/sweden r/privatekonomi', forums: '' },
    'Norway':               { terms: 'Norway Norwegian NOK krone', reddit: 'r/norway r/norge', forums: '' },
    'Denmark':              { terms: 'Denmark Danish DKK krone', reddit: 'r/Denmark', forums: '' },
    'Poland':               { terms: 'Poland Polish PLN zloty', reddit: 'r/poland r/Polska', forums: '' },
    'Portugal':             { terms: 'Portugal Portuguese EUR euro', reddit: 'r/portugal', forums: '' },
    'Ireland':              { terms: 'Ireland Irish EUR euro', reddit: 'r/ireland r/irishpersonalfinance', forums: '' },
    'India':                { terms: 'India Indian INR rupees', reddit: 'r/india r/IndiaInvestments r/indiabusiness', forums: '' },
    'Australia':            { terms: 'Australia Australian AUD dollars', reddit: 'r/australia r/AusFinance r/AusEntrepreneur', forums: '' },
    'Philippines':          { terms: 'Philippines Filipino PHP peso', reddit: 'r/Philippines r/phclassifieds', forums: '' },
    'Singapore':            { terms: 'Singapore Singaporean SGD', reddit: 'r/singapore r/singaporefi', forums: '' },
    'Malaysia':             { terms: 'Malaysia Malaysian MYR ringgit', reddit: 'r/malaysia r/MalaysianPF', forums: '' },
    'Indonesia':            { terms: 'Indonesia Indonesian IDR rupiah', reddit: 'r/indonesia', forums: '' },
    'Pakistan':             { terms: 'Pakistan Pakistani PKR rupee', reddit: 'r/pakistan', forums: '' },
    'Bangladesh':           { terms: 'Bangladesh Bangladeshi BDT taka', reddit: 'r/bangladesh', forums: '' },
    'Sri Lanka':            { terms: 'Sri Lanka LKR rupee', reddit: 'r/srilanka', forums: '' },
    'New Zealand':          { terms: 'New Zealand NZD dollars', reddit: 'r/newzealand r/PersonalFinanceNZ', forums: '' },
    'Japan':                { terms: 'Japan Japanese JPY yen', reddit: 'r/japan r/japanfinance', forums: '' },
    'South Korea':          { terms: 'South Korea Korean KRW won', reddit: 'r/korea', forums: '' },
    'UAE':                  { terms: 'UAE Dubai Abu Dhabi AED dirham', reddit: 'r/dubai r/UAE', forums: '' },
    'Saudi Arabia':         { terms: 'Saudi Arabia SAR riyal', reddit: 'r/saudiarabia', forums: '' },
    'Qatar':                { terms: 'Qatar QAR riyal', reddit: 'r/qatar', forums: '' },
    'Kuwait':               { terms: 'Kuwait KWD dinar', reddit: 'r/kuwait', forums: '' },
    'Jordan':               { terms: 'Jordan JOD dinar', reddit: 'r/jordan', forums: '' },
    'Brazil':               { terms: 'Brazil Brazilian BRL real', reddit: 'r/brasil r/investimentos', forums: '' },
    'Colombia':             { terms: 'Colombia Colombian COP peso', reddit: 'r/colombia', forums: '' },
    'Argentina':            { terms: 'Argentina Argentine ARS peso', reddit: 'r/argentina', forums: '' },
    'Chile':                { terms: 'Chile Chilean CLP peso', reddit: 'r/chile', forums: '' },
    'Peru':                 { terms: 'Peru Peruvian PEN sol', reddit: 'r/peru', forums: '' },
    'Jamaica':              { terms: 'Jamaica Jamaican JMD dollar', reddit: 'r/jamaica', forums: '' },
    'Trinidad and Tobago':  { terms: 'Trinidad Tobago TTD dollar', reddit: 'r/trinidadandtobago', forums: '' },
    'Barbados':             { terms: 'Barbados Barbadian BBD dollar', reddit: 'r/barbados', forums: '' },
  };

  const countryMod   = country ? (countryModifiers[country] || { terms: country, reddit: '', forums: '' }) : null;
  const countryTerms = countryMod ? countryMod.terms : '';
  const countryLabel = country || 'Global';

  // ── ISO country codes for Tavily native country parameter ────────────────
  const COUNTRY_CODES = {
    'Nigeria':'ng','South Africa':'za','Kenya':'ke','Ghana':'gh','Egypt':'eg',
    'Ethiopia':'et','Tanzania':'tz','Uganda':'ug','Rwanda':'rw','Cameroon':'cm',
    'Senegal':'sn','Zimbabwe':'zw','United States':'us','Canada':'ca','Mexico':'mx',
    'United Kingdom':'gb','Germany':'de','France':'fr','Netherlands':'nl','Spain':'es',
    'Italy':'it','Sweden':'se','Norway':'no','Denmark':'dk','Poland':'pl',
    'Portugal':'pt','Ireland':'ie','India':'in','Australia':'au','Philippines':'ph',
    'Singapore':'sg','Malaysia':'my','Indonesia':'id','Pakistan':'pk','Bangladesh':'bd',
    'Sri Lanka':'lk','New Zealand':'nz','Japan':'jp','South Korea':'kr','UAE':'ae',
    'Saudi Arabia':'sa','Qatar':'qa','Kuwait':'kw','Jordan':'jo','Brazil':'br',
    'Colombia':'co','Argentina':'ar','Chile':'cl','Peru':'pe','Jamaica':'jm',
    'Trinidad and Tobago':'tt','Barbados':'bb',
  };
  const countryCode = country ? (COUNTRY_CODES[country] || null) : null;

  try {
    let searches;

    if (isKeyword) {
      // ── KEYWORD MODE ──────────────────────────────────────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" ${countryTerms} review OR problem OR help OR how OR question`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}" ${countryTerms}`, tag: 'quora' },
        { query: `"${searchTerm}" ${countryTerms} how to OR "is it worth" OR "does it work" OR "vs" ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" ${countryTerms} beginners guide problems getting started ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" ${countryTerms} review tutorial ${currentYear}`, tag: 'youtube' },
        { query: `"${searchTerm}" ${countryTerms} site:x.com OR site:twitter.com ${currentYear}`, tag: 'x' },
      ];
    } else {
      // ── NICHE MODE ─────────────────────────────────────────────────────────
      searches = [
        { query: `site:reddit.com "${searchTerm}" ${countryTerms} question help struggling ${currentYear}`, tag: 'reddit' },
        { query: `site:quora.com "${searchTerm}" ${countryTerms} how why what ${currentYear}`, tag: 'quora' },
        { query: `"${searchTerm}" ${countryTerms} how to start results proof stuck ${currentYear}`, tag: 'google' },
        { query: `"${searchTerm}" ${countryTerms} is it worth it saturated too late ${currentYear}`, tag: 'google' },
        { query: `site:youtube.com "${searchTerm}" ${countryTerms} ${currentYear} how to mistakes`, tag: 'youtube' },
        { query: `"${searchTerm}" ${countryTerms} site:x.com question struggle ${currentYear}`, tag: 'x' },
        ...(countryMod && countryMod.forums ? [{ query: `site:${countryMod.forums} "${searchTerm}"`, tag: 'forum' }] : []),
      ];
    }

    // ── Run Tavily searches + SerpApi Trends simultaneously ──────────────────
    const [tavilyResults, trendsData] = await Promise.all([
      Promise.allSettled(
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
              ...(countryCode ? { country: countryCode } : {}),
            }),
          })
          .then(r => r.json())
          .then(d => ({ ...d, _tag: s.tag }))
          .catch(() => ({ _tag: s.tag, results: [] }))
        )
      ),
      // ── SerpApi Google Trends — related + rising queries ─────────────────
      SERPAPI_KEY ? fetchGoogleTrends(searchTerm, countryCode, SERPAPI_KEY) : Promise.resolve(null),
    ]);

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
      return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, country);
    }

    // ── Format trends data for Claude ────────────────────────────────────────
    let trendsContext = '';
    if (trendsData) {
      const rising  = trendsData.rising  || [];
      const related = trendsData.related || [];
      if (rising.length || related.length) {
        trendsContext = `\n\nGOOGLE TRENDS DATA for "${searchTerm}"${country ? ` in ${country}` : ''} (REAL search demand):\n`;
        if (rising.length)  trendsContext += `RISING SEARCHES (growing fast right now): ${rising.slice(0,8).map(q => `"${q.query}"${q.value ? ` (+${q.value}%)` : ''}`).join(', ')}\n`;
        if (related.length) trendsContext += `TOP RELATED SEARCHES: ${related.slice(0,8).map(q => `"${q.query}"`).join(', ')}\n`;
        trendsContext += `\nIMPORTANT: Questions that map to RISING SEARCHES should be ranked higher — they reflect what people are actively searching for RIGHT NOW. Mention "trending search" in the why field for these.\n`;
      }
    }

    // ── Claude extracts and ranks questions by post-worthiness ────────────────
    const rawText = rawResults
      .slice(0, 30)
      .map(r => `[${r.tag.toUpperCase()}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
      .join('\n\n');

    const rankPrompt = `You are a content strategist who helps experts in the "${niche}" space create high-performing social media posts.

${country ? `TARGET COUNTRY: ${country}
The questions must be specifically relevant to people in ${country}. Consider their:
- Local economic context, currency, and income levels
- Platforms popular in ${country}
- Cultural attitudes toward digital business, money, and online income
- Language patterns and terminology used locally
- Local regulations, payment methods, and market conditions

` : ''}Below are real search results. Your job is to extract the 8 BEST questions for writing sharp, authoritative posts targeted at ${countryLabel} audiences.
${trendsContext}
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

${exclude.length > 0 ? `\n\nEXCLUDE — do NOT return questions similar to these already shown:\n${exclude.slice(0,10).map((q,i) => `${i+1}. ${q}`).join('\n')}` : ''}

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

    if (!match) return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, country);

    const questions = JSON.parse(match[0]);
    return res.status(200).json({
      questions,
      source: 'live',
      total:  questions.length,
      trends: trendsData ? {
        rising:  (trendsData.rising  || []).slice(0, 5),
        related: (trendsData.related || []).slice(0, 5),
      } : null,
    });

  } catch (err) {
    console.error('[vpe-questions] Error:', err.message);
    return await fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche);
  }
}

// ── Fallback: Claude generates from training knowledge ────────────────────────
async function fallbackGenerate(searchTerm, intel, CLAUDE_KEY, res, isKeyword, niche, country = '') {
  const currentYear = new Date().getFullYear();
  const countryCtx  = country ? `\nTARGET COUNTRY: ${country}\nGenerate questions specifically relevant to people in ${country}. Consider their local context, platforms, currency, income levels, and cultural attitudes toward digital business.` : '';
  try {
    const prompt = `Generate the 8 best questions someone could write a sharp, authoritative social media post about in the "${niche}" space.

${isKeyword ? `The questions must be specifically about: "${searchTerm}"` : `The questions must be relevant to: "${searchTerm}"`}
${countryCtx}

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

${exclude.length > 0 ? `\n\nDo NOT return questions similar to:\n${exclude.slice(0,8).map((q,i) => `${i+1}. ${q}`).join('\n')}` : ''}

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

// ── Google Trends via SerpApi ─────────────────────────────────────────────────
async function fetchGoogleTrends(keyword, countryCode, serpApiKey) {
  try {
    const geo = countryCode ? countryCode.toUpperCase() : '';

    // Build URL manually to ensure correct parameter encoding
    const baseUrl = 'https://serpapi.com/search.json';
    const params = {
      engine:    'google_trends',
      q:         keyword,
      data_type: 'RELATED_QUERIES',
      date:      'today 12-m',
      hl:        'en',
      api_key:   serpApiKey,
    };
    if (geo) params.geo = geo;

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    console.log(`[SerpApi] Fetching trends: q="${keyword}" geo="${geo}"`);

    const resp = await fetch(`${baseUrl}?${queryString}`);
    if (!resp.ok) {
      const errText = await resp.text();
      console.warn('[SerpApi] Trends fetch failed:', resp.status, errText.slice(0, 200));
      return null;
    }

    const data = await resp.json();

    // Log what came back for debugging
    console.log('[SerpApi] Raw response keys:', Object.keys(data).join(', '));

    if (data.error) {
      console.warn('[SerpApi] API error:', data.error);
      return null;
    }

    const relatedQueries = data.related_queries || {};
    const allRising = (relatedQueries.rising || []).map(q => ({
      query: q.query,
      value: q.extracted_value || q.value || '',
      link:  q.link || '',
    }));
    const allTop = (relatedQueries.top || []).map(q => ({
      query: q.query,
      value: '',
      link:  q.link || '',
    }));

    // Filter to keep only queries relevant to the keyword
    const keywordWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const isRelevant = (q) => {
      const ql = q.query.toLowerCase();
      return keywordWords.some(w => ql.includes(w));
    };

    const rising  = allRising.filter(isRelevant);
    const related = allTop.filter(isRelevant);

    // If filtering removes everything, return unfiltered with a warning
    if (rising.length === 0 && related.length === 0) {
      console.warn('[SerpApi] Relevance filter removed all results for', keyword, '— using unfiltered');
      console.warn('[SerpApi] Raw rising queries:', allRising.slice(0,3).map(q => q.query).join(', '));
      return {
        rising:   allRising.slice(0, 6),
        related:  allTop.slice(0, 6),
        keyword,
        geo,
        filtered: false,
      };
    }

    console.log(`[SerpApi] ✅ ${rising.length} rising, ${related.length} top for "${keyword}" in ${geo||'global'}`);
    return { rising: rising.slice(0, 6), related: related.slice(0, 6), keyword, geo, filtered: true };

  } catch(e) {
    console.warn('[SerpApi] Trends error:', e.message);
    return null;
  }
}
