/**
 * api/generate-affiliate.js
 *
 * Three modes, all powered by Boardroom collective intelligence:
 *
 *   type=avatar   — scrapes product page + layers Boardroom market research
 *                   to build a hyper-specific buyer avatar
 *   type=calendar — 7-day content calendar grounded in Boardroom hooks,
 *                   email subjects, DM openers and avatar language
 *   type=funnel   — premium affiliate bridge/review page using the same
 *                   design system as generate-funnel.js, copy derived from
 *                   Boardroom positioning and avatar intelligence
 *
 * All three accept boardroomIntel + userContext in the request body.
 * If absent they fall back to their original behaviour.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });

  const {
    type, productUrl, productName, commission, monthlyTarget,
    niche, trafficMode, avatarData,
    boardroomIntel, userContext,
  } = req.body || {};

  const av = avatarData    || {};
  const bi = boardroomIntel || null;
  const uc = userContext    || {};

  // ── BOARDROOM CONTEXT BLOCK (injected into every prompt when available) ──
  const BR = bi ? `
═══════════════════════════════════════════════════════
BOARDROOM COLLECTIVE INTELLIGENCE — USE AS FOUNDATION
This comes from live Tavily market research + the user's
exact situation. Build everything on this intelligence.
═══════════════════════════════════════════════════════
Market Gap:         ${bi.marketGapFound        || ''}
Positioning:        ${bi.positioningStatement  || ''}
Dominance Angle:    ${bi.dominanceAngle        || ''}
Unique Mechanism:   ${bi.uniqueMechanism       || ''}
Category to Own:    ${bi.categoryDesign        || ''}
Target Customer:    ${bi.targetCustomerSentence|| ''}
Avatar Pain:        ${uc.av_pain              || ''}
Avatar Fear:        ${uc.av_fear              || ''}
Transformation:     ${uc.transformation       || ''}
Objections:         ${uc.av_objections        || ''}
Platform:           ${uc.platform             || ''}
Proven Headlines:   ${(bi.headlines||[]).join(' | ')}
Proven Hooks:       ${(bi.week1ContentHooks||[]).join(' | ')}
Proven DM Openers:  ${(bi.dmOpeners||[]).join(' | ')}
Email Subjects:     ${(bi.emailSubjects||[]).join(' | ')}
Content Pillars:    ${(bi.contentPillars||[]).join(' | ')}
VSL Opener:         ${bi.vslOpener            || ''}
Closing Script:     ${bi.closingScript        || ''}
Mentor Note:        ${bi.mentorNote           || ''}
Offer Positioning:  ${bi.offerPositioning     || ''}
═══════════════════════════════════════════════════════
` : '';

  // ════════════════════════════════════════════════════════════════════════════
  // TYPE: AVATAR
  // Scrapes product page + layers Boardroom market research on top
  // ════════════════════════════════════════════════════════════════════════════
  if (type === 'avatar') {
    if (!productUrl && !productName) {
      return res.status(400).json({ error: 'Paste your affiliate product URL before analysing.' });
    }

    let pageContent = '';
    if (productUrl) {
      try {
        const pageResp = await fetch(productUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(12000),
        });
        if (pageResp.ok) {
          const html = await pageResp.text();
          pageContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .substring(0, 6000).trim();
        }
      } catch(e) { console.warn('Page scrape failed:', e.message); }
    }

    const productSection = pageContent
      ? `REAL PRODUCT PAGE (scraped from ${productUrl}):\n"""\n${pageContent}\n"""\nBase ALL analysis on this actual content.`
      : `Product: "${productName||'Not provided'}"\nNiche: ${niche||'Online Business'}\nNote: No product URL — base on product name and niche.`;

    const prompt = `You are an elite market researcher and buyer psychology expert embedded inside Execution-OS.
${BR}
An affiliate marketer wants to promote this product:
${productSection}

Commission: $${Number(commission||1000).toLocaleString()} per sale
Monthly target: $${Number(monthlyTarget||(Number(commission)||1000)*5).toLocaleString()}
Traffic strategy: ${trafficMode||'organic'}

${bi ? `INSTRUCTION: Layer the Boardroom intelligence above onto the product page data.
The avatar must combine:
1. What the actual product page says (claims, benefits, transformation)
2. The avatar pains and objections already identified in the Boardroom research
3. The market gap and positioning angle to ensure the affiliate content stands out
If the product page confirms what Boardroom found — use that exact language.
If there is a conflict — trust the product page data for product-specific claims,
trust the Boardroom data for audience psychology and market positioning.` : ''}

Build a precise buyer avatar. Return ONLY valid JSON:
{
  "name": "Avatar name matching this product's real target buyer",
  "age": "Most common buyer age range",
  "gender": "Primary gender demographic",
  "location": "Primary locations this product targets",
  "job": "Exact job title of the ideal buyer",
  "industry": "Their industry",
  "income": "Their current income range",
  "current": "2 sentences: their specific frustrating situation that makes THIS product relevant",
  "desired": "2 sentences: the exact outcome THIS product promises them",
  "incomeGoal": "${monthlyTarget||10000}",
  "transformation": "The #1 transformation THIS product delivers — from real product claims",
  "fear": "Their biggest fear about buying a product like this",
  "tried": "Specific things they have already tried that failed",
  "pain": "Core pain in 5-7 words — specific to this product's market",
  "motivation": "What drives them beyond money",
  "personality": "3-word personality description",
  "influences": "3 real influencers or communities in this exact niche",
  "objections": "Top 2 objections specific to this product's price point and claims",
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "productName": "${productName||'the product'}",
  "productUrl": "${productUrl||''}",
  "commission": ${Number(commission||1000)},
  "niche": "${niche||'Online Business'}",
  "realClaims": ["Actual claim from the product page 1","Actual claim 2","Actual claim 3"],
  "contentAngles": [
    "Content angle grounded in real product benefit + Boardroom market gap",
    "Content angle 2",
    "Content angle 3"
  ],
  "boardroomAligned": "${bi ? 'yes' : 'no'}",
  "dominanceAngle": "${bi ? (bi.dominanceAngle||'') : ''}",
  "dmStrategy": "2 sentences on the best DM approach for this product's audience and price point"
}`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      const raw = (d.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      if (s === -1) return res.status(500).json({ error: 'Invalid response format.' });
      const result = JSON.parse(raw.substring(s, e+1));
      result._hadPageContent = pageContent.length > 100;
      result._pageScraped    = !!productUrl;
      result._boardroomPowered = !!bi;
      return res.status(200).json(result);
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TYPE: CALENDAR
  // 7-day content calendar — Boardroom hooks, DM openers and email subjects
  // used as the creative foundation. Never generic. Always specific.
  // ════════════════════════════════════════════════════════════════════════════
  if (type === 'calendar') {
    const realClaims    = (av.realClaims   ||[]).join(', ') || 'the product benefits';
    const contentAngles = (av.contentAngles||[]).join(' | ')|| '';

    // Boardroom proven assets to seed the content
    const provenHooks    = bi ? (bi.week1ContentHooks||[]).join('\n- ') : '';
    const provenDMs      = bi ? (bi.dmOpeners       ||[]).join('\n- ') : '';
    const provenSubjects = bi ? (bi.emailSubjects    ||[]).join('\n- ') : '';
    const provenPillars  = bi ? (bi.contentPillars   ||[]).join(' | ') : '';

    const prompt = `You are an expert affiliate content strategist embedded inside Execution-OS — a 9-figure digital product platform.
${BR}
PRODUCT: "${av.productName||productName||'affiliate product'}"
${av.productUrl ? `PRODUCT URL: ${av.productUrl}` : ''}
COMMISSION: $${Number(commission||av.commission||1000).toLocaleString()} per sale
NICHE: ${niche||av.niche||'Online Business'}
TRAFFIC: ${trafficMode==='paid' ? 'Paid Ads' : 'Organic Content + DMs'}

REAL PRODUCT CLAIMS (from the actual product page):
${realClaims}

BUYER AVATAR:
- Who:              ${av.job||'professional'} in ${av.industry||'their field'}
- Core pain:        "${av.pain||'their main struggle'}"
- Transformation:   "${av.transformation||'their desired outcome'}"
- Fear:             "${av.fear||'wasting money'}"
- Already tried:    "${av.tried||'various solutions'}"
- Motivation:       "${av.motivation||'freedom and success'}"
- Dominance angle:  "${av.dominanceAngle||bi?.dominanceAngle||''}"

CONTENT ANGLES (from real product + Boardroom research):
${contentAngles}

${bi ? `BOARDROOM-PROVEN ASSETS — USE THESE AS THE FOUNDATION:
Hooks to adapt (do not copy verbatim — adapt to this product):
- ${provenHooks}

DM openers to adapt:
- ${provenDMs}

Email subjects to adapt:
- ${provenSubjects}

Content pillars: ${provenPillars}

Closing script to adapt: ${bi.closingScript||''}

INSTRUCTION: Adapt the proven Boardroom hooks and email subjects above for this
specific product and avatar. They are battle-tested for this niche and audience.
Every hook, subject line and DM opener must feel like it was written specifically
for this person's pain — not like a generic template.` : ''}

WEEK STRATEGY:
- Days 1-3: Educate about the PROBLEM only. Never mention the product. Build trust and authority.
- Days 4-5: Introduce the product naturally using its REAL claims and benefits.
- Days 6-7: Drive action. Use real testimonial tone. Clear CTA to affiliate link.

Write ALL 7 DAYS. Each day must use a different emotional trigger and angle.

FORMAT each day exactly like this:

DAY [N]: [Specific topic tied to real product benefits and avatar pain]

FACEBOOK POST (200-260 words):
[Full post. First line stops scroll. Short paragraphs. Perfect grammar. Specific to this audience. End with a question or CTA.]

REEL 1 (35-45 seconds):
HOOK: [First 3 seconds — specific niche pain — adapted from Boardroom hooks if available]
SCRIPT: [Word-for-word. Natural speech. References real pain or transformation.]
CAPTION: [2 lines + 5 niche hashtags]

REEL 2 (35-45 seconds):
HOOK: [Different angle from Reel 1]
SCRIPT: [3 teaching points. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

EMAIL:
SUBJECT: [Under 45 chars — specific, not generic — adapted from Boardroom subjects if available]
PREVIEW: [Under 80 chars]
BODY: [200-240 words. One real insight. One action. Sign off with name.]

RULES:
- Perfect grammar throughout — every sentence
- Active voice always
- Sound like a real human who uses this product — not AI
- Reference REAL pain points and transformations from the product and Boardroom research
- Every hook and opener must feel niche-specific — not interchangeable with other niches
- Never mention commission or that it is affiliate marketing
- Never use: "game-changer", "journey", "in today's world", "let's be honest", "unlock"`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      return res.status(200).json({ text: d.content?.[0]?.text||'', _boardroomPowered: !!bi });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TYPE: FUNNEL
  // Generates a premium affiliate bridge/review page.
  // Copy is derived from Boardroom positioning + avatar intelligence.
  // Uses the same design system as generate-funnel.js.
  // ════════════════════════════════════════════════════════════════════════════
  if (type === 'funnel') {
    const affiliateUrl = av.productUrl || productUrl || '#';

    const prompt = `You are the world's best direct-response affiliate copywriter embedded inside Execution-OS.
${BR}
Build a high-converting affiliate bridge/review page for:
PRODUCT: "${av.productName||productName||'the product'}"
AFFILIATE LINK: "${affiliateUrl}"
COMMISSION: $${Number(commission||av.commission||1000).toLocaleString()}
NICHE: ${niche||av.niche||'Online Business'}

AVATAR:
- Pain: "${av.pain||uc.av_pain||''}"
- Fear: "${av.fear||uc.av_fear||''}"
- Transformation: "${av.transformation||uc.transformation||''}"
- Tried: "${av.tried||''}"
- Real product claims: ${(av.realClaims||[]).join(', ')}

${bi ? `BOARDROOM INSTRUCTION:
- Headline MUST be adapted from: ${(bi.headlines||[]).join(' | ')}
- Subheadline MUST reflect: ${bi.targetCustomerSentence||''}
- Dominance angle: ${bi.dominanceAngle||''}
- Use avatar's exact pain language in bullets
- Badge must reflect: ${bi.uniqueMechanism||''}` : ''}

The page warms up traffic before sending them to the affiliate offer.
It positions the user as the guide who found the solution — not a salesperson.
Every bullet starts with "You will..." and contains a specific outcome.

Return ONLY valid JSON:
{
  "headline": "max 8 words, <em> on key phrase, adapted from Boardroom headlines",
  "subheadline": "one sentence: specific person + outcome + removes objection",
  "badge": "3-5 words using unique mechanism name",
  "bullets": ["You will... (x5, specific outcomes with numbers)"],
  "cta": "3-5 words, action + specific benefit",
  "cta_note": "short trust line",
  "form_headline": "Get Access to [Product Name]",
  "social_proof": "ticker: real-feeling number + niche result",
  "result_stat": "ticker: average result with number",
  "trust_line": "ticker: money-back or access guarantee",
  "proof_bar": [
    { "num": "X,XXX+", "label": "label" },
    { "num": "XX%", "label": "label" },
    { "num": "$XX,XXX", "label": "label" }
  ],
  "testimonials": [
    { "name": "First Last, context", "quote": "specific result with number", "result": "$X,XXX in X weeks" },
    { "name": "...", "quote": "...", "result": "..." },
    { "name": "...", "quote": "...", "result": "..." }
  ],
  "features_headline": "What you get with [Product Name]",
  "features": [
    { "icon": "emoji", "title": "feature title", "desc": "one benefit line" },
    { "icon": "emoji", "title": "...", "desc": "..." },
    { "icon": "emoji", "title": "...", "desc": "..." }
  ],
  "faq_headline": "Common Questions",
  "faq": [
    { "q": "question using avatar language", "a": "answer that removes the objection" },
    { "q": "...", "a": "..." },
    { "q": "...", "a": "..." }
  ],
  "final_cta_headline": "urgency-driven closing headline",
  "final_cta_sub": "removes the last objection in one sentence",
  "cta_url": "${affiliateUrl}",
  "copy_headline": "why this product is the missing piece",
  "copy_body": "2-3 sentences positioning you as guide who found the solution"
}`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });

      let text = (d.content?.[0]?.text||'').trim().replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```\s*$/,'').trim();
      let copy;
      try { copy = JSON.parse(text); }
      catch(e) { return res.status(200).json({ content:[{type:'text',text}], _boardroomPowered:!!bi }); }

      // Affiliate bridge pages always send to the affiliate link — no popup
      copy.cta_url = affiliateUrl;
      const html = renderAffiliatePage(copy, affiliateUrl);
      return res.status(200).json({ content:[{type:'text',text:html}], _boardroomPowered:!!bi });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(400).json({ error: 'Invalid type. Use: avatar | calendar | funnel' });
};

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATE BRIDGE PAGE RENDERER
// Sends traffic directly to the affiliate link (no optin popup).
// CTA button opens affiliate URL. Sticky bar follows the user down.
// ─────────────────────────────────────────────────────────────────────────────
function renderAffiliatePage(c, affiliateUrl) {
  const url = affiliateUrl || c.cta_url || '#';

  const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Poppins:ital,wght@0,700;0,800;0,900;1,800&display=swap" rel="stylesheet">`;

  const CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{background:#060610;color:#c0c8e0;font-family:'Inter',sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
    em{font-style:italic}a{text-decoration:none}
    .container{max-width:700px;margin:0 auto;padding:0 28px}
    .section{padding:80px 0}.section-dark{background:#060610}.section-mid{background:#0b0b1a}.section-alt{background:#0e0e20}
    .headline{font-family:'Poppins',sans-serif;font-weight:900;line-height:1.05;letter-spacing:-2px;color:#fff}
    .headline-xl{font-size:clamp(36px,5.8vw,62px)}.headline-lg{font-size:clamp(26px,4vw,42px)}.headline-md{font-size:clamp(20px,3vw,30px)}
    .subline{font-size:17px;color:#7a85a8;line-height:1.7;max-width:560px}
    .label-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#4ecca3}
    .grad{background:linear-gradient(135deg,#4ecca3 0%,#7b6ff0 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .badge{display:inline-flex;align-items:center;gap:8px;background:rgba(78,204,163,.08);border:1px solid rgba(78,204,163,.18);color:#4ecca3;padding:6px 16px;border-radius:100px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:24px}
    .badge-dot{width:6px;height:6px;border-radius:50%;background:#4ecca3;animation:pulse 2s ease infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
    .ticker-wrap{background:rgba(78,204,163,.04);border-bottom:1px solid rgba(78,204,163,.08);padding:10px 0;overflow:hidden;white-space:nowrap}
    .ticker-inner{display:inline-flex;animation:ticker 32s linear infinite}
    @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .ticker-item{display:inline-flex;align-items:center;gap:8px;padding:0 28px;font-size:12px;color:#5a6480;font-weight:500}
    .ticker-sep{color:#4ecca3;opacity:.5;font-size:16px}
    .cta-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#4ecca3 0%,#38b88e 100%);color:#040408;font-family:'Poppins',sans-serif;font-weight:900;font-size:15px;letter-spacing:.3px;padding:18px 52px;border-radius:10px;border:none;cursor:pointer;text-align:center;transition:all .25s;box-shadow:0 0 50px rgba(78,204,163,.2),0 4px 24px rgba(0,0,0,.5);text-transform:uppercase;white-space:nowrap;text-decoration:none}
    .cta-btn:hover{transform:translateY(-3px);box-shadow:0 0 80px rgba(78,204,163,.35),0 12px 36px rgba(0,0,0,.6)}
    .cta-btn svg{width:18px;height:18px;flex-shrink:0}
    .cta-note{font-size:11px;color:#3a3a5c;margin-top:12px;text-align:center;letter-spacing:.3px}
    .bullets{list-style:none;display:flex;flex-direction:column;gap:16px}
    .bullets li{display:flex;align-items:flex-start;gap:14px;font-size:15px;color:#a0aac0;line-height:1.6}
    .check-wrap{width:22px;height:22px;border-radius:50%;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
    .check-wrap svg{width:10px;height:10px}
    .proof-bar{display:flex;justify-content:center;gap:0;flex-wrap:wrap}
    .proof-item{text-align:center;padding:24px 32px;position:relative}
    .proof-item:not(:last-child)::after{content:'';position:absolute;right:0;top:50%;transform:translateY(-50%);height:40px;width:1px;background:rgba(255,255,255,.06)}
    .proof-num{font-family:'Poppins',sans-serif;font-weight:900;font-size:30px;line-height:1;letter-spacing:-1px}
    .proof-label{font-size:11px;color:#5a6480;margin-top:4px;font-weight:500}
    .testi-card{background:#0e0e22;border:1px solid rgba(255,255,255,.05);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:12px}
    .testi-stars{color:#f0c040;font-size:13px;letter-spacing:3px}
    .testi-quote{font-size:14px;color:#9098b5;line-height:1.75;font-style:italic}
    .testi-author{display:flex;align-items:center;gap:10px;margin-top:4px}
    .testi-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4ecca3,#7b6ff0);display:flex;align-items:center;justify-content:center;font-family:'Poppins',sans-serif;font-weight:800;font-size:13px;color:#040408;flex-shrink:0}
    .testi-name{font-size:13px;font-weight:700;color:#fff}
    .testi-result{font-size:11px;color:#4ecca3;font-weight:600}
    .feature-card{background:#0e0e22;border:1px solid rgba(255,255,255,.05);border-radius:16px;padding:28px 24px;text-align:center;transition:all .25s}
    .feature-card:hover{border-color:rgba(78,204,163,.15);transform:translateY(-3px)}
    .feature-icon{font-size:32px;margin-bottom:12px}
    .feature-title{font-family:'Poppins',sans-serif;font-weight:700;font-size:14px;color:#fff;margin-bottom:6px}
    .feature-desc{font-size:12px;color:#5a6480;line-height:1.6}
    .faq-item{border:1px solid rgba(255,255,255,.05);border-radius:12px;overflow:hidden;cursor:pointer;transition:border-color .2s}
    .faq-item:hover{border-color:rgba(78,204,163,.1)}
    .faq-q{padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
    .faq-q-text{font-size:14px;font-weight:600;color:#d0d8f0;line-height:1.4}
    .faq-icon{width:24px;height:24px;border-radius:50%;background:rgba(78,204,163,.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .25s}
    .faq-item.open .faq-icon{transform:rotate(45deg)}
    .faq-a{padding:0 20px;max-height:0;overflow:hidden;transition:all .3s ease}
    .faq-item.open .faq-a{max-height:200px;padding:0 20px 18px}
    .faq-a p{font-size:13px;color:#6b7280;line-height:1.75}
    .divider{width:48px;height:3px;background:linear-gradient(90deg,#4ecca3,#7b6ff0);border-radius:2px;margin:14px auto 32px}
    .hero-glow{position:absolute;top:-80px;left:50%;transform:translateX(-50%);width:800px;height:600px;background:radial-gradient(ellipse,rgba(78,204,163,.05) 0%,rgba(123,111,240,.03) 40%,transparent 70%);pointer-events:none;z-index:0}
    .sticky-bar{position:fixed;bottom:0;left:0;right:0;background:rgba(6,6,16,.95);backdrop-filter:blur(12px);border-top:1px solid rgba(78,204,163,.1);padding:14px 24px;z-index:100;display:flex;align-items:center;justify-content:center;gap:16px;transform:translateY(100%);transition:transform .4s cubic-bezier(.34,1.2,.64,1)}
    .sticky-bar.visible{transform:translateY(0)}
    .sticky-text{font-size:13px;color:#7a85a8}.sticky-text strong{color:#fff}
    @media(max-width:640px){
      .section{padding:60px 0}.container{padding:0 18px}
      .cta-btn{width:100%;padding:17px 24px;justify-content:center}
      .proof-item{padding:20px 16px}.proof-num{font-size:24px}
      .sticky-bar{flex-direction:column;gap:10px;padding:16px}.sticky-bar .cta-btn{width:100%}
      .sticky-text{display:none}
    }
  `;

  const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  const CHECK = `<svg viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#4ecca3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const bullets = (arr) => !arr?.length ? '' :
    `<ul class="bullets">${arr.map(b=>`<li><div class="check-wrap">${CHECK}</div><span>${b}</span></li>`).join('')}</ul>`;

  const testimonials = (arr) => !arr?.length ? '' :
    arr.map(t=>{
      const init=(t.name||'A').charAt(0).toUpperCase();
      return `<div class="testi-card"><div class="testi-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><p class="testi-quote">"${t.quote}"</p><div class="testi-author"><div class="testi-avatar">${init}</div><div><p class="testi-name">${t.name}</p>${t.result?`<p class="testi-result">&#10022; ${t.result}</p>`:''}</div></div></div>`;
    }).join('');

  const proofBar = (arr) => !arr?.length ? '' :
    `<div class="proof-bar">${arr.map(p=>`<div class="proof-item"><div class="proof-num grad">${p.num}</div><div class="proof-label">${p.label}</div></div>`).join('')}</div>`;

  const ticker = () => {
    const items = [c.social_proof||'2,847 people joined this week', c.result_stat||'Average member sees results in 30 days', c.trust_line||'100% satisfaction guaranteed']
      .map(i=>`<span class="ticker-item">${i}<span class="ticker-sep">&#10022;</span></span>`).join('');
    return `<div class="ticker-wrap"><div class="ticker-inner" aria-hidden="true">${items}${items}${items}</div></div>`;
  };

  const faqSection = (arr) => !arr?.length ? '' : `
<section class="section section-mid">
  <div class="container" style="text-align:center">
    <p class="label-tag" style="margin-bottom:8px">Questions Answered</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.faq_headline||'Common Questions'}</h2>
    <div class="divider"></div>
    <div style="display:flex;flex-direction:column;gap:8px;text-align:left;margin-top:8px">
      ${arr.map(f=>`<div class="faq-item"><div class="faq-q"><span class="faq-q-text">${f.q}</span><div class="faq-icon"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="#4ecca3" stroke-width="1.5" stroke-linecap="round"/></svg></div></div><div class="faq-a"><p>${f.a}</p></div></div>`).join('')}
    </div>
  </div>
</section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  ${FONTS}
  <title>${c.headline||'Check This Out'}</title>
  <style>${CSS}</style>
</head>
<body>
${ticker()}

<section class="section section-dark" id="hero-section" style="position:relative;overflow:hidden;padding-top:96px;padding-bottom:96px;text-align:center">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:20px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 40px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 44px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <a class="cta-btn" href="${url}" target="_blank" rel="noopener" style="margin-bottom:12px">${c.cta||'Get Access Now'}${ARROW}</a>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>

${c.proof_bar&&c.proof_bar.length?`<div style="background:#0b0b1a;border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04)"><div class="container">${proofBar(c.proof_bar)}</div></div>`:''}

${c.copy_headline||c.copy_body?`
<section class="section section-alt" style="text-align:center">
  <div class="container">
    ${c.copy_headline?`<h2 class="headline headline-lg" style="margin-bottom:8px">${c.copy_headline}</h2><div class="divider"></div>`:''}
    ${c.copy_body?`<p style="font-size:16px;color:#7a85a8;max-width:580px;margin:0 auto 36px;line-height:1.85">${c.copy_body}</p>`:''}
    <a class="cta-btn" href="${url}" target="_blank" rel="noopener" style="margin-bottom:12px">${c.cta||'Get Access Now'}${ARROW}</a>
  </div>
</section>`:''}

${c.testimonials&&c.testimonials.length?`
<section class="section section-mid">
  <div class="container" style="text-align:center">
    <p class="label-tag" style="margin-bottom:8px">Real Results</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">People are getting results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
  </div>
</section>`:''}

${c.features&&c.features.length?`
<section class="section section-dark">
  <div class="container" style="text-align:center">
    <p class="label-tag" style="margin-bottom:8px">What You Get</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.features_headline||'Everything included'}</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:8px">
      ${c.features.map(f=>`<div class="feature-card"><div class="feature-icon">${f.icon||'✓'}</div><p class="feature-title">${f.title}</p><p class="feature-desc">${f.desc||''}</p></div>`).join('')}
    </div>
  </div>
</section>`:''}

${faqSection(c.faq)}

<section class="section section-alt" style="text-align:center">
  <div class="container">
    <p class="label-tag" style="margin-bottom:8px">Don't Wait</p>
    <h2 class="headline headline-lg" style="margin-bottom:10px">${c.final_cta_headline||'Ready to get started?'}</h2>
    ${c.final_cta_sub?`<p class="subline" style="margin:0 auto 32px">${c.final_cta_sub}</p>`:'<div style="height:28px"></div>'}
    <a class="cta-btn" href="${url}" target="_blank" rel="noopener" style="margin-bottom:12px">${c.cta||'Get Access Now'}${ARROW}</a>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>

<div class="sticky-bar" id="sticky-bar">
  <p class="sticky-text">Limited spots available &mdash; <strong>don't miss out.</strong></p>
  <a class="cta-btn" href="${url}" target="_blank" rel="noopener" style="padding:14px 36px;font-size:13px">${c.cta||'Get Access Now'}${ARROW}</a>
</div>

<script>
(function(){
  var bar=document.getElementById('sticky-bar'), heroBottom=0;
  window.addEventListener('scroll',function(){
    if(!heroBottom){var h=document.getElementById('hero-section');if(h)heroBottom=h.getBoundingClientRect().bottom+window.scrollY;}
    bar.classList.toggle('visible',window.scrollY>heroBottom-80);
  },{passive:true});
  document.querySelectorAll('.faq-item').forEach(function(i){
    i.addEventListener('click',function(){
      var o=i.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open');});
      if(!o)i.classList.add('open');
    });
  });
})();
</script>
</body></html>`;
}

// ── Vercel function duration config ─────────────────────────────────────
// The 'calendar' branch above generates a full 7-day content plan (Facebook
// post + 2 reels + email per day, up to 4000 tokens) in a single AI call.
// That genuinely takes 30-60+ seconds to generate. Without this config,
// Vercel applies its default timeout (as low as 10-15s) and kills the
// function before the AI response finishes, even on the Pro plan — Pro
// only raises the *ceiling*, it doesn't change the default unless this
// is set explicitly.
module.exports.config = {
  maxDuration: 60, // seconds — requires Vercel Pro plan or higher to take effect above 10s
};
