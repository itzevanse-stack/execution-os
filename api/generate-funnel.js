/**
 * api/generate-funnel.js
 *
 * Every funnel, page, and piece of copy is built on top of the Boardroom's
 * collective intelligence — live market research, real positioning, avatar
 * language, and the user's exact offer context.
 *
 * Request body:
 *   prompt        — raw user instruction
 *   mode          — optin | vsl | booking | bridge
 *   max_tokens    — optional cap
 *   boardroomIntel — full output from api/boardroom (positioning, copy, market)
 *   userContext   — { niche, offerName, price, target, av_pain, av_fear,
 *                     av_objections, transformation, platform, audience }
 *
 * If boardroomIntel is present every piece of copy is derived from it —
 * headlines, positioning, avatar language, proof numbers, hooks, everything.
 * If absent the system falls back to the generic best-practice prompt.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel.' });

  const { prompt, max_tokens, mode, intelContext } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const ic = intelContext || {};
  const isAffiliate = !!ic.isAffiliate;

  // ── BUILD INTELLIGENCE BLOCK ───────────────────────────────────────────────
  // Mode-isolated — Affiliate reads from Offer Setup, Expert from Boardroom
  const INTEL_BLOCK = `
═══════════════════════════════════════════════════════════════
${isAffiliate ? 'AFFILIATE OFFER INTELLIGENCE' : 'BOARDROOM INTELLIGENCE'}
Use this as the FOUNDATION for every word of copy.
Do NOT invent positioning, pain points, or copy from scratch.
Every headline, bullet, and CTA must come from this data.
═══════════════════════════════════════════════════════════════

OFFER:
  ${isAffiliate ? 'Product being promoted:' : 'Offer name:'}    ${ic.offerName || ''}
  Niche:                  ${ic.niche || ''}
  Price / Commission:     ${ic.price ? '$' + ic.price : ''}${ic.commission ? ' ($' + ic.commission + ' commission per sale)' : ''}
  ${ic.coreTransformation ? 'Core transformation:    ' + ic.coreTransformation : ''}
  ${ic.signatureFramework ? 'Signature framework:    ' + ic.signatureFramework : ''}
  ${ic.guarantee          ? 'Guarantee:              ' + ic.guarantee          : ''}
  ${ic.benefits           ? 'Key benefits:           ' + ic.benefits           : ''}
  ${ic.affiliateUrl       ? 'Affiliate URL:          ' + ic.affiliateUrl       : ''}

IDEAL BUYER PSYCHOLOGY — use their EXACT language:
  Their core pain:        ${ic.pain || ''}
  Deeper emotional wound: ${ic.deeperPain || ''}
  Their deepest fear:     ${ic.fear || ''}
  What they have tried:   ${ic.tried || ''}
  Transformation they want: ${ic.transformation || ''}
  How they see themselves:  ${ic.identity || ''}
  Their motivation:       ${ic.motivation || ''}
  Key objections:         ${ic.objections || ''}
  ${ic.avatarJob  ? 'Who they are:           ' + ic.avatarJob  : ''}
  ${ic.keywords   ? 'Their exact language:   ' + ic.keywords   : ''}

POSITIONING:
  ${ic.dominanceAngle        ? 'Dominance angle:        ' + ic.dominanceAngle        : ''}
  ${ic.positioningStatement  ? 'Positioning statement:  ' + ic.positioningStatement  : ''}
  ${ic.uniqueMechanism       ? 'Unique mechanism:       ' + ic.uniqueMechanism       : ''}
  ${ic.marketGap             ? 'Market gap:             ' + ic.marketGap             : ''}
  ${ic.categoryDesign        ? 'Category to own:        ' + ic.categoryDesign        : ''}
  ${ic.targetCustomerLine    ? 'Target customer:        ' + ic.targetCustomerLine    : ''}
  ${isAffiliate ? 'IMPORTANT: You are an affiliate recommending this product — you discovered it and recommend it from personal experience. You are NOT the creator. Never position yourself as the product owner.' : 'You ARE the expert and creator. Every word should reflect your authority and genuine desire to help your specific audience.'}

PROVEN COPY ASSETS — adapt these, do NOT ignore them:
  ${ic.headlines && ic.headlines.length    ? 'Headlines:              ' + ic.headlines.join(' | ')    : ''}
  ${ic.hooks     && ic.hooks.length        ? 'Proven hooks:           ' + ic.hooks.join(' | ')        : ''}
  ${ic.dmOpeners && ic.dmOpeners.length    ? 'DM openers:             ' + ic.dmOpeners.join(' | ')    : ''}
  ${ic.vslOpener                           ? 'VSL opener:             ' + ic.vslOpener               : ''}
  ${ic.contentPillars && ic.contentPillars.length ? 'Content pillars:        ' + ic.contentPillars.join(', ') : ''}
  ${ic.contentAngles                       ? 'Content angles:         ' + ic.contentAngles           : ''}
  ${ic.emailSubjects && ic.emailSubjects.length ? 'Email subjects:         ' + ic.emailSubjects.join(' | ') : ''}

${ic.voiceTone || ic.voiceStyle || ic.voiceExample ? `VOICE PROFILE — match this exactly in every word:
  Tone:     ${ic.voiceTone  || ''}
  Style:    ${ic.voiceStyle || ''}
  ${ic.voicePhrases ? 'Always use: ' + ic.voicePhrases : ''}
  ${ic.voiceAvoid   ? 'Never say:  ' + ic.voiceAvoid   : ''}
  ${ic.voiceStory   ? 'Their story: ' + ic.voiceStory  : ''}
  ${ic.voiceExample ? 'Match this voice:\n  ' + ic.voiceExample : ''}` : ''}

REVENUE CONTEXT:
  ${ic.monthlyTarget ? 'Monthly target: $' + ic.monthlyTarget : ''}
  ${ic.salesNeeded   ? 'Sales needed:   ' + ic.salesNeeded + ' per month' : ''}

═══════════════════════════════════════════════════════════════
INSTRUCTIONS:
1. Every headline MUST be adapted from the proven headlines above
2. Every bullet MUST use the buyer's exact pain/fear language
3. The subheadline MUST name the exact target customer and outcome
4. Testimonials MUST reflect the real transformation this audience wants
5. The CTA MUST reflect the offer name and the buyer's desired outcome
6. Proof numbers MUST feel congruent with the niche
7. Every sentence must feel like it was written for THIS specific audience
8. ${isAffiliate ? 'Never reveal you are promoting for commission — speak as a genuine recommender' : 'Speak with full authority as the creator of this offer'}
═══════════════════════════════════════════════════════════════
`;


  const SYSTEM = `You are the world's best direct-response copywriter and funnel strategist embedded inside Execution OS — a platform for online coaches, digital product creators, and affiliate marketers. You write copy that converts because you combine deep audience intelligence with proven direct-response principles.
${INTEL_BLOCK}
COPY RULES — Non-negotiable regardless of context:

HEADLINES:
- MAX 8 words. Lead with specific result or number. Never vague.
- RIGHT: "Make $3,000/Month Promoting Other People's Products"
- RIGHT: "Get 3 Paying Clients In The Next 30 Days"
- WRONG: "Discover The System That Transforms Your Business"
- Use <em> tags on the single most powerful word or phrase
- If Boardroom headlines are provided, adapt the strongest one — do not ignore them

SUBHEADLINE:
- One sentence. Name the EXACT person + EXACT outcome + removes objection
- "For [specific person] who want to [specific result] without [specific obstacle]"
- Pull directly from the Target Customer Sentence when available

BULLETS (5-7):
- Every bullet starts with "You will..." — never "Learn", "Discover", "Get access to"
- At least 3 bullets must contain a specific number
- Outcomes only: "You will close your first $2,000 client in 14 days" not "Sales strategies"
- Pull from avatar pains and transformation when Boardroom intel is available

SOCIAL PROOF:
- Specific numbers always: "2,847" not "thousands", "94%" not "most"
- Testimonials: Full name, specific $ result, specific timeframe
- Numbers must feel congruent with the niche — do not invent unrealistic numbers

CTA:
- 3-5 words. Action verb + specific benefit
- RIGHT: "Get My Free Training", "Claim Your Free Spot", "Start Earning Today"
- WRONG: "Submit", "Sign Up", "Click Here"
- Must reflect the offer name when available

NEVER USE:
- Em dashes or hyphens in prose
- "game-changer", "journey", "transform", "unlock", "leverage", "skyrocket", "blueprint"
- Hollow phrases, generic corporate language
- Any copy that could apply to any niche (must be niche-specific)

PROOF INTEGRITY — ABSOLUTE RULES:
- NEVER invent testimonials, client names, quotes, or dollar results. If the intelligence above contains REAL client results or proof, use those verbatim. If it does not, return "testimonials": [] (empty array) — the page renders cleanly without that section and the user adds real proof later.
- NEVER invent user counts, revenue totals, or percentages for proof_bar. If real numbers exist in the intelligence, use them. Otherwise use non-numeric trust markers instead: e.g. { "num": "Step-by-Step", "label": "No experience needed" }, { "num": "Guaranteed", "label": "Or your money back" }, { "num": "Beginner Friendly", "label": "Start from zero" }.
- Social proof ticker lines follow the same rule: real numbers or none.
- A page with honest trust markers converts better long-term than one with invented proof that destroys credibility the moment a visitor questions it.

Return ONLY valid JSON. No markdown. No backticks. No explanation.

JSON SCHEMA (all fields required):
{
  "headline": "max 8 words, <em> on key phrase",
  "subheadline": "one sentence, specific person + outcome",
  "badge": "3-5 words, credibility signal or unique mechanism name",
  "bullets": ["You will... (x5-7, outcome-focused, specific numbers)"],
  "cta": "3-5 words",
  "cta_note": "short trust line",
  "form_headline": "short, action-oriented, e.g. Get Instant Access Below",
  "social_proof": "ticker: real number + result",
  "result_stat": "ticker: average result with number",
  "trust_line": "ticker: guarantee or trust signal",
  "proof_bar": [
    { "num": "X,XXX+", "label": "label" },
    { "num": "XX%", "label": "label" },
    { "num": "$XX,XXX", "label": "label" }
  ],
  "testimonials": [
    { "name": "First Last, context", "quote": "specific result with number and timeframe", "result": "$X,XXX in X weeks" },
    { "name": "...", "quote": "...", "result": "..." },
    { "name": "...", "quote": "...", "result": "..." }
  ],
  "features_headline": "What you get when you join",
  "features": [
    { "icon": "emoji", "title": "short title", "desc": "one line benefit" },
    { "icon": "emoji", "title": "...", "desc": "..." },
    { "icon": "emoji", "title": "...", "desc": "..." },
    { "icon": "emoji", "title": "...", "desc": "..." }
  ],
  "faq_headline": "Common Questions",
  "faq": [
    { "q": "question using their language", "a": "direct answer that removes objection" },
    { "q": "...", "a": "..." },
    { "q": "...", "a": "..." }
  ],
  "final_cta_headline": "urgency-driven close headline",
  "final_cta_sub": "one sentence that removes the last objection",
  "cta_url": "#",
  "copy_headline": "for VSL/bridge pages",
  "copy_body": "2-3 sentences, for VSL/bridge pages",
  "calendar_headline": "for booking pages",
  "guarantee": { "headline": "...", "body": "..." },
  "video_note": "for VSL — one line shown below video"
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: Math.min(max_tokens || 4000, 4000),
        system:     SYSTEM,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json(e); }

    const d    = await r.json();
    let   text = (d.content?.[0]?.text || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```\s*$/, '').trim();

    let copy;
    try { copy = JSON.parse(text); }
    catch(e) { return res.status(200).json({ content: [{ type: 'text', text }], model: 'claude-sonnet-4-6' }); }

    const html = renderTemplate(copy, mode || 'optin', ic.niche);
    return res.status(200).json({ content: [{ type: 'text', text: html }], model: 'claude-sonnet-4-6' });

  } catch(e) {
    console.error('generate-funnel:', e.message);
    return res.status(500).json({ error: e.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// RENDER TEMPLATE — Complete rewrite for agency-quality funnel pages
// ─────────────────────────────────────────────────────────────────────────────
function renderTemplate(c, mode, niche) {

  const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:ital,wght@0,700;0,800;0,900;1,800&display=swap" rel="stylesheet">`;

  // ── NICHE-ADAPTIVE DESIGN THEMES ────────────────────────────────────────
  // Every funnel used to ship the identical dark teal/purple look regardless
  // of who the user is — which is what makes pages feel templated. Now the
  // aesthetic adapts to the niche: a wellness coach, a finance educator, and
  // a fitness trainer each get a distinctly different, professionally
  // matched look, applied as a CSS override layer on top of the base design
  // system so layout and typography quality stay identical.
  const ACTIVE_THEME = pickTheme(niche); // niche passed per request from the handler
  function pickTheme(niche) {
    const n = String(niche || '').toLowerCase();
    if (/wellness|mindset|mindfulness|meditat|yoga|health coach|life coach|healing|spiritual|therapy|relationship|parenting|nutrition/.test(n)) return 'radiance';
    if (/finance|invest|trading|wealth|money|real estate|property|account|tax|legal|consult|b2b|agency|saas/.test(n)) return 'authority';
    if (/fitness|gym|workout|training|sport|muscle|weight loss|bodybuild|running|athlet|performance/.test(n)) return 'voltage';
    return 'momentum';
  }

  const THEME_CSS = {
    momentum: '',
    radiance: `
/* THEME: Radiance — warm, light, trustworthy (wellness/coaching) */
body{background:#faf6f0;color:#5c5348}
strong{color:#2b241c}
.headline{color:#2b241c}
.section-dark{background:#faf6f0}.section-mid{background:#f4ede3}.section-alt{background:#efe6d9}
.section-accent{background:linear-gradient(180deg,#f4ede3 0%,#efe6d9 100%)}
.subline,.subline-sm{color:#8a7f6f}
.eyebrow{color:#c2703d}
.grad{background:linear-gradient(135deg,#c2703d 0%,#a8862d 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.badge{background:rgba(194,112,61,.08);border-color:rgba(194,112,61,.25);color:#c2703d}
.badge-dot{background:#c2703d}
.ticker-wrap{background:rgba(194,112,61,.04);border-color:rgba(194,112,61,.1)}
.ticker-item{color:#a89a86}.ticker-dot{color:#c2703d}
.btn-primary{background:linear-gradient(135deg,#c2703d 0%,#a85c2e 100%);color:#fff;box-shadow:0 0 60px rgba(194,112,61,.22),0 8px 32px rgba(60,40,20,.18)}
.btn-primary:hover{box-shadow:0 0 100px rgba(194,112,61,.32),0 16px 48px rgba(60,40,20,.24)}
.btn-secondary{color:#c2703d;border-color:rgba(194,112,61,.35)}
.btn-secondary:hover{background:rgba(194,112,61,.06);border-color:rgba(194,112,61,.55)}
.cta-note{color:#b0a490}
.divider{background:linear-gradient(90deg,#c2703d,#a8862d)}
.hero-glow{background:radial-gradient(ellipse,rgba(194,112,61,.08) 0%,rgba(168,134,45,.05) 40%,transparent 68%)}
.hero-line{background:linear-gradient(90deg,transparent,rgba(194,112,61,.18),transparent)}
.proof-bar{background:#f4ede3;border-color:rgba(60,40,20,.06)}
.proof-item:not(:last-child)::after{background:rgba(60,40,20,.08)}
.proof-num{color:#2b241c}.proof-label{color:#a89a86}
.bullets li{color:#6d6355}
.check-wrap{background:rgba(194,112,61,.1);border-color:rgba(194,112,61,.3)}
.testi-card{background:#fffdf9;border-color:rgba(60,40,20,.08)}
.testi-card:hover{border-color:rgba(194,112,61,.25)}`,
    authority: `
/* THEME: Authority — deep navy + gold (finance/consulting/B2B) */
body{background:#0a1020;color:#a8b2c8}
.section-dark{background:#0a1020}.section-mid{background:#0d1428}.section-alt{background:#101a33}
.section-accent{background:linear-gradient(180deg,#0d1428 0%,#101a33 100%)}
.eyebrow{color:#d4a94e}
.grad{background:linear-gradient(135deg,#d4a94e 0%,#e8ca85 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.badge{background:rgba(212,169,78,.07);border-color:rgba(212,169,78,.22);color:#d4a94e}
.badge-dot{background:#d4a94e}
.ticker-wrap{background:rgba(212,169,78,.03);border-color:rgba(212,169,78,.08)}
.ticker-dot{color:#d4a94e}
.btn-primary{background:linear-gradient(135deg,#d4a94e 0%,#b8903c 100%);color:#0a1020;box-shadow:0 0 60px rgba(212,169,78,.2),0 8px 32px rgba(0,0,0,.4)}
.btn-primary:hover{box-shadow:0 0 100px rgba(212,169,78,.32),0 16px 48px rgba(0,0,0,.5)}
.btn-secondary{color:#d4a94e;border-color:rgba(212,169,78,.3)}
.btn-secondary:hover{background:rgba(212,169,78,.06);border-color:rgba(212,169,78,.5)}
.divider{background:linear-gradient(90deg,#d4a94e,#e8ca85)}
.hero-glow{background:radial-gradient(ellipse,rgba(212,169,78,.06) 0%,rgba(232,202,133,.04) 40%,transparent 68%)}
.hero-line{background:linear-gradient(90deg,transparent,rgba(212,169,78,.14),transparent)}
.proof-bar{background:#0d1428}
.check-wrap{background:rgba(212,169,78,.1);border-color:rgba(212,169,78,.25)}
.testi-card{background:#111a30}
.testi-card:hover{border-color:rgba(212,169,78,.15)}`,
    voltage: `
/* THEME: Voltage — high-energy dark + electric orange (fitness/performance) */
body{background:#0b0a09;color:#b8b0a8}
.section-dark{background:#0b0a09}.section-mid{background:#12100d}.section-alt{background:#171410}
.section-accent{background:linear-gradient(180deg,#12100d 0%,#171410 100%)}
.eyebrow{color:#ff6b2b}
.grad{background:linear-gradient(135deg,#ff6b2b 0%,#ffb02b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.badge{background:rgba(255,107,43,.07);border-color:rgba(255,107,43,.25);color:#ff6b2b}
.badge-dot{background:#ff6b2b}
.ticker-wrap{background:rgba(255,107,43,.03);border-color:rgba(255,107,43,.08)}
.ticker-dot{color:#ff6b2b}
.btn-primary{background:linear-gradient(135deg,#ff6b2b 0%,#e5551a 100%);color:#fff;box-shadow:0 0 60px rgba(255,107,43,.25),0 8px 32px rgba(0,0,0,.45)}
.btn-primary:hover{box-shadow:0 0 100px rgba(255,107,43,.4),0 16px 48px rgba(0,0,0,.55)}
.btn-secondary{color:#ff6b2b;border-color:rgba(255,107,43,.3)}
.btn-secondary:hover{background:rgba(255,107,43,.06);border-color:rgba(255,107,43,.5)}
.divider{background:linear-gradient(90deg,#ff6b2b,#ffb02b)}
.hero-glow{background:radial-gradient(ellipse,rgba(255,107,43,.08) 0%,rgba(255,176,43,.04) 40%,transparent 68%)}
.hero-line{background:linear-gradient(90deg,transparent,rgba(255,107,43,.16),transparent)}
.proof-bar{background:#12100d}
.check-wrap{background:rgba(255,107,43,.1);border-color:rgba(255,107,43,.28)}
.testi-card{background:#171310}
.testi-card:hover{border-color:rgba(255,107,43,.18)}`
  };

  const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#06060f;color:#b8c2e0;font-family:'Inter',system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{max-width:100%;display:block}a{text-decoration:none;color:inherit}em{font-style:italic}strong{color:#e8edf8}

/* ── LAYOUT ── */
.container{max-width:800px;margin:0 auto;padding:0 32px}
.container-wide{max-width:1100px;margin:0 auto;padding:0 32px}
.section{padding:88px 0}
.section-dark{background:#06060f}
.section-mid{background:#09091a}
.section-alt{background:#0c0c1e}
.section-accent{background:linear-gradient(180deg,#09091a 0%,#0b0b20 100%)}
.text-center{text-align:center}

/* ── TYPOGRAPHY ── */
.headline{font-family:'Poppins',sans-serif;font-weight:900;line-height:1.05;letter-spacing:-1.5px;color:#fff}
.headline-xl{font-size:clamp(40px,6.5vw,72px)}
.headline-lg{font-size:clamp(28px,4.2vw,46px)}
.headline-md{font-size:clamp(22px,3vw,32px)}
.headline-sm{font-size:clamp(18px,2.5vw,24px)}
.subline{font-size:18px;color:#7a85a8;line-height:1.8;max-width:580px}
.subline-sm{font-size:15px;color:#7a85a8;line-height:1.75}
.eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:#4ecca3;margin-bottom:16px}

/* gradient text */
.grad{background:linear-gradient(135deg,#4ecca3 0%,#7b6ff0 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* ── BADGE ── */
.badge{display:inline-flex;align-items:center;gap:8px;background:rgba(78,204,163,.07);border:1px solid rgba(78,204,163,.2);color:#4ecca3;padding:7px 18px;border-radius:100px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:24px}
.badge-dot{width:6px;height:6px;border-radius:50%;background:#4ecca3;animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}

/* ── TICKER ── */
.ticker-wrap{background:rgba(78,204,163,.03);border-bottom:1px solid rgba(78,204,163,.07);padding:11px 0;overflow:hidden;white-space:nowrap}
.ticker-inner{display:inline-flex;animation:tick 30s linear infinite}
@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.ticker-item{display:inline-flex;align-items:center;gap:10px;padding:0 32px;font-size:12px;color:#4a5268;font-weight:500}
.ticker-dot{color:#4ecca3;opacity:.6;font-size:18px;line-height:1}

/* ── CTA BUTTON ── */
.btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#4ecca3 0%,#3ab890 100%);color:#030308;font-family:'Poppins',sans-serif;font-weight:900;font-size:16px;letter-spacing:.3px;padding:20px 56px;border-radius:12px;border:none;cursor:pointer;text-align:center;transition:all .25s cubic-bezier(.4,0,.2,1);box-shadow:0 0 60px rgba(78,204,163,.2),0 8px 32px rgba(0,0,0,.4);text-transform:uppercase;white-space:nowrap;position:relative;overflow:hidden}
.btn-primary::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);opacity:0;transition:opacity .25s}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 0 100px rgba(78,204,163,.35),0 16px 48px rgba(0,0,0,.5)}
.btn-primary:hover::before{opacity:1}
.btn-primary:active{transform:translateY(-1px)}
.btn-primary svg{width:18px;height:18px;flex-shrink:0}
.btn-secondary{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:#4ecca3;font-family:'Poppins',sans-serif;font-weight:700;font-size:14px;padding:14px 36px;border-radius:10px;border:1.5px solid rgba(78,204,163,.3);cursor:pointer;transition:all .2s}
.btn-secondary:hover{background:rgba(78,204,163,.06);border-color:rgba(78,204,163,.5)}
.cta-note{font-size:12px;color:#3a3a5a;margin-top:14px;text-align:center;letter-spacing:.2px}

/* ── DIVIDER ── */
.divider{width:52px;height:3px;background:linear-gradient(90deg,#4ecca3,#7b6ff0);border-radius:2px;margin:16px auto 40px}
.divider-left{margin-left:0}

/* ── HERO GLOW ── */
.hero-glow{position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:1000px;height:700px;background:radial-gradient(ellipse,rgba(78,204,163,.06) 0%,rgba(123,111,240,.04) 40%,transparent 68%);pointer-events:none;z-index:0}
.hero-line{position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(78,204,163,.12),transparent)}

/* ── PROOF BAR ── */
.proof-bar{display:flex;justify-content:center;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04);background:#08081a}
.proof-item{text-align:center;padding:28px 40px;position:relative;flex:1;min-width:140px}
.proof-item:not(:last-child)::after{content:'';position:absolute;right:0;top:50%;transform:translateY(-50%);height:48px;width:1px;background:rgba(255,255,255,.05)}
.proof-num{font-family:'Poppins',sans-serif;font-weight:900;font-size:34px;color:#fff;line-height:1;letter-spacing:-1px}
.proof-label{font-size:11px;color:#4a5268;margin-top:6px;font-weight:500;letter-spacing:.4px;text-transform:uppercase}

/* ── BULLETS ── */
.bullets{list-style:none;display:flex;flex-direction:column;gap:18px}
.bullets li{display:flex;align-items:flex-start;gap:14px;font-size:16px;color:#9098b8;line-height:1.65}
.check-wrap{width:24px;height:24px;border-radius:50%;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
.check-wrap svg{width:11px;height:11px}

/* ── TESTIMONIALS ── */
.testi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;text-align:left}
.testi-card{background:#0e0e24;border:1px solid rgba(255,255,255,.05);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:14px;transition:border-color .2s}
.testi-card:hover{border-color:rgba(78,204,163,.1)}
.testi-stars{color:#f0c040;font-size:14px;letter-spacing:3px}
.testi-quote{font-size:14px;color:#8090b8;line-height:1.8;font-style:italic}
.testi-author{display:flex;align-items:center;gap:12px;margin-top:4px;padding-top:14px;border-top:1px solid rgba(255,255,255,.04)}
.testi-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#4ecca3,#7b6ff0);display:flex;align-items:center;justify-content:center;font-family:'Poppins',sans-serif;font-weight:900;font-size:15px;color:#030308;flex-shrink:0}
.testi-name{font-size:13px;font-weight:700;color:#e0e8f8}
.testi-result{font-size:11px;color:#4ecca3;font-weight:700;letter-spacing:.4px;margin-top:1px}

/* ── FEATURES / WHAT YOU GET ── */
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.feature-card{background:#0e0e24;border:1px solid rgba(255,255,255,.05);border-radius:18px;padding:30px 24px;text-align:center;transition:all .25s}
.feature-card:hover{border-color:rgba(78,204,163,.15);transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,.3)}
.feature-icon{font-size:36px;margin-bottom:14px}
.feature-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:14px;color:#e8edf8;margin-bottom:6px}
.feature-desc{font-size:12px;color:#5a6480;line-height:1.65}

/* ── VALUE STACK ── */
.value-stack{display:flex;flex-direction:column;gap:0;border:1px solid rgba(78,204,163,.12);border-radius:18px;overflow:hidden}
.value-item{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,.04);background:#0c0c20}
.value-item:last-child{border-bottom:none}
.value-item:first-child{background:#0e0e24}
.value-name{display:flex;align-items:center;gap:12px;font-size:14px;color:#c0c8e0;font-weight:500}
.value-name-icon{font-size:18px}
.value-price{font-family:'Poppins',sans-serif;font-weight:800;font-size:14px;color:#4ecca3}
.value-total{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;background:linear-gradient(135deg,rgba(78,204,163,.06),rgba(123,111,240,.04));border-top:1px solid rgba(78,204,163,.12)}
.value-total-label{font-family:'Poppins',sans-serif;font-weight:900;font-size:15px;color:#fff}
.value-total-price{font-family:'Poppins',sans-serif;font-weight:900;font-size:22px;color:#4ecca3}

/* ── PRICE REVEAL ── */
.price-box{background:#0e0e24;border:2px solid rgba(78,204,163,.15);border-radius:20px;padding:40px;text-align:center;max-width:480px;margin:0 auto}
.price-was{font-size:18px;color:#4a5268;text-decoration:line-through;margin-bottom:8px}
.price-now{font-family:'Poppins',sans-serif;font-weight:900;font-size:64px;color:#fff;line-height:1;letter-spacing:-2px}
.price-period{font-size:16px;color:#7a85a8;margin-top:6px}

/* ── WHO THIS IS FOR ── */
.for-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.for-card{border-radius:16px;padding:24px}
.for-card-yes{background:rgba(78,204,163,.04);border:1px solid rgba(78,204,163,.12)}
.for-card-no{background:rgba(239,68,68,.03);border:1px solid rgba(239,68,68,.08)}
.for-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:13px;margin-bottom:14px;letter-spacing:.3px}
.for-title-yes{color:#4ecca3}
.for-title-no{color:#ef4444}
.for-list{list-style:none;display:flex;flex-direction:column;gap:10px}
.for-list li{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:#8090b0;line-height:1.5}
.for-list .icon{flex-shrink:0;font-size:14px;margin-top:1px}

/* ── GUARANTEE ── */
.guarantee-box{background:#0e0e24;border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:48px;display:flex;align-items:flex-start;gap:28px;max-width:680px;margin:0 auto;text-align:left}
.guarantee-icon{font-size:56px;flex-shrink:0}
.guarantee-title{font-family:'Poppins',sans-serif;font-weight:900;font-size:22px;color:#fff;margin-bottom:10px}
.guarantee-body{font-size:15px;color:#7a85a8;line-height:1.8}

/* ── FAQ ── */
.faq-list{display:flex;flex-direction:column;gap:8px;max-width:680px;margin:0 auto}
.faq-item{background:#0c0c1e;border:1px solid rgba(255,255,255,.05);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color .2s}
.faq-item:hover{border-color:rgba(78,204,163,.1)}
.faq-q{padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.faq-q-text{font-size:14px;font-weight:600;color:#d0d8f0;line-height:1.4}
.faq-icon{width:26px;height:26px;border-radius:50%;background:rgba(78,204,163,.07);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .3s cubic-bezier(.4,0,.2,1)}
.faq-icon svg{width:12px;height:12px;stroke:#4ecca3;stroke-width:2.5;transition:transform .3s}
.faq-item.open .faq-icon{transform:rotate(45deg)}
.faq-a{padding:0 22px;max-height:0;overflow:hidden;transition:all .35s ease}
.faq-item.open .faq-a{max-height:200px;padding:0 22px 20px}
.faq-a p{font-size:13px;color:#6b7280;line-height:1.8}

/* ── URGENCY BAR ── */
.urgency-bar{background:linear-gradient(135deg,rgba(239,68,68,.06),rgba(245,101,40,.06));border:1px solid rgba(239,68,68,.12);border-radius:14px;padding:18px 24px;display:flex;align-items:center;gap:14px;max-width:600px;margin:0 auto}
.urgency-icon{font-size:22px;flex-shrink:0}
.urgency-text{font-size:13px;color:#ef4444;font-weight:700}
.urgency-sub{font-size:12px;color:#7a85a8;margin-top:2px}

/* ── FORM / MODAL ── */
.modal-overlay{position:fixed;inset:0;background:rgba(4,4,12,.94);backdrop-filter:blur(12px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .3s}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:#0f0f22;border:1px solid rgba(78,204,163,.12);border-radius:22px;padding:44px 40px;max-width:460px;width:100%;position:relative;transform:scale(.92) translateY(24px);transition:all .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 40px 80px rgba(0,0,0,.6)}
.modal-overlay.open .modal{transform:scale(1) translateY(0)}
.modal-close{position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#6b7280;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s}
.modal-close:hover{background:rgba(255,255,255,.1);color:#fff}
.modal-step{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#4ecca3;margin-bottom:8px}
.modal-title{font-family:'Poppins',sans-serif;font-weight:900;font-size:24px;color:#fff;line-height:1.2;margin-bottom:6px}
.modal-sub{font-size:13px;color:#6b7280;margin-bottom:28px;line-height:1.65}
.modal-divider{height:1px;background:rgba(255,255,255,.05);margin:0 -40px 28px}
.field-wrap{margin-bottom:16px}
.field-label{font-size:11px;font-weight:600;color:#4a5270;text-transform:uppercase;letter-spacing:1px;margin-bottom:7px;display:block}
.field{width:100%;background:#08081a;border:1.5px solid rgba(255,255,255,.06);border-radius:12px;padding:15px 16px;color:#e0e8f8;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:all .2s;-webkit-appearance:none}
.field:focus{border-color:rgba(78,204,163,.4);background:#0a0a1c;box-shadow:0 0 0 4px rgba(78,204,163,.06)}
.field::placeholder{color:#2a2a48}

/* ── STICKY BAR ── */
.sticky-bar{position:fixed;bottom:0;left:0;right:0;background:rgba(6,6,16,.97);backdrop-filter:blur(16px);border-top:1px solid rgba(78,204,163,.08);padding:16px 28px;z-index:500;display:flex;align-items:center;justify-content:center;gap:20px;transform:translateY(100%);transition:transform .45s cubic-bezier(.34,1.2,.64,1)}
.sticky-bar.visible{transform:translateY(0)}
.sticky-text{font-size:13px;color:#6b7280;font-weight:500}
.sticky-text strong{color:#e0e8f8}

/* ── STEP NUMBERS ── */
.steps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.step-card{background:#0c0c1e;border:1px solid rgba(255,255,255,.04);border-radius:16px;padding:28px 24px;display:flex;gap:16px;align-items:flex-start}
.step-num{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(78,204,163,.15),rgba(123,111,240,.1));border:1px solid rgba(78,204,163,.2);display:flex;align-items:center;justify-content:center;font-family:'Poppins',sans-serif;font-weight:900;font-size:16px;color:#4ecca3;flex-shrink:0}
.step-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:14px;color:#e8edf8;margin-bottom:4px}
.step-body{font-size:12px;color:#5a6480;line-height:1.6}

/* ── VIDEO PLAYER ── */
.video-wrap{background:#07070f;border:1px solid rgba(78,204,163,.08);border-radius:18px;overflow:hidden;aspect-ratio:16/9;max-width:720px;margin:0 auto;display:flex;align-items:center;justify-content:center;position:relative}
.video-play{width:80px;height:80px;border-radius:50%;background:rgba(78,204,163,.07);border:1.5px solid rgba(78,204,163,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .25s}
.video-play:hover{background:rgba(78,204,163,.12);transform:scale(1.08)}
.video-play svg{width:28px;height:28px;fill:#4ecca3;margin-left:3px}
.video-viewers{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(4,4,12,.85);border:1px solid rgba(255,255,255,.06);border-radius:100px;padding:6px 16px;font-size:11px;color:#5a6480;white-space:nowrap}
.video-viewers span{color:#4ecca3;font-weight:700}

@media(max-width:680px){
  .container,.container-wide{padding:0 20px}
  .section{padding:64px 0}
  .headline-xl{font-size:38px}
  .headline-lg{font-size:28px}
  .subline{font-size:16px}
  .btn-primary{width:100%;padding:18px 24px}
  .proof-item{padding:20px 20px}.proof-num{font-size:26px}
  .for-grid{grid-template-columns:1fr}
  .guarantee-box{flex-direction:column;gap:16px;padding:28px}
  .modal{padding:32px 24px}.modal-divider{margin:0 -24px 24px}
  .sticky-bar{flex-direction:column;gap:10px}.sticky-bar .btn-primary{width:100%}
  .sticky-text{display:none}
  .value-stack{font-size:13px}
  .price-now{font-size:48px}
}
  `;

  const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  const CHECK = `<svg viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#4ecca3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const PLUS  = `<svg viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  // ── HELPER COMPONENTS ─────────────────────────────────────────────────────

  const ticker = () => {
    const items = [
      c.social_proof  || '2,847+ people joined this week',
      c.result_stat   || 'Average member sees results in 30 days',
      c.trust_line    || '30-day money-back guarantee — zero risk',
      '⭐ Rated 4.9/5 by verified members',
    ];
    const doubled = [...items,...items];
    return `<div class="ticker-wrap"><div class="ticker-inner">${doubled.map(t=>`<span class="ticker-item"><span class="ticker-dot">•</span>${t}</span>`).join('')}</div></div>`;
  };

  const bullets = (arr=[]) => `<ul class="bullets">${arr.map(b=>`<li><span class="check-wrap">${CHECK}</span><span>${b}</span></li>`).join('')}</ul>`;

  const proofBar = (items=[]) => items.length
    ? `<div class="proof-bar">${items.map(p=>`<div class="proof-item"><div class="proof-num">${p.num||''}</div><div class="proof-label">${p.label||''}</div></div>`).join('')}</div>`
    : '';

  const testimonials = (arr=[]) => arr.length
    ? `<div class="testi-grid">${arr.map(t=>{
        const initials = (t.name||'A').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
        return `<div class="testi-card"><div class="testi-stars">★★★★★</div><p class="testi-quote">"${t.quote||''}"</p><div class="testi-author"><div class="testi-avatar">${initials}</div><div><div class="testi-name">${t.name||''}</div><div class="testi-result">${t.result||''}</div></div></div></div>`;
      }).join('')}</div>`
    : '';

  const proofSection = (arr=[]) => arr.length
    ? `<div class="proof-bar container-wide">${arr.map(p=>`<div class="proof-item"><div class="proof-num">${p.num}</div><div class="proof-label">${p.label}</div></div>`).join('')}</div>`
    : '';

  const faqSection = (arr=[]) => arr && arr.length
    ? `<section class="section section-mid text-center"><div class="container"><div class="eyebrow">Common Questions</div><h2 class="headline headline-lg" style="margin-bottom:12px">${c.faq_headline||'Everything you need to know'}</h2><div class="divider"></div><div class="faq-list" style="margin-top:8px">${arr.map(f=>`<div class="faq-item"><div class="faq-q"><span class="faq-q-text">${f.q||''}</span><span class="faq-icon">${PLUS}</span></div><div class="faq-a"><p>${f.a||''}</p></div></div>`).join('')}</div></div></section>`
    : '';

  const valueStack = (features=[]) => features.length
    ? `<section class="section section-mid text-center"><div class="container"><div class="eyebrow">Everything Included</div><h2 class="headline headline-lg" style="margin-bottom:12px">${c.features_headline||'What you get when you join'}</h2><div class="divider"></div><div class="value-stack" style="margin-top:8px">${features.map((f,i)=>`<div class="value-item"><span class="value-name"><span class="value-name-icon">${f.icon||'✓'}</span>${f.title||''}</span><span class="value-price">${f.value||'Priceless'}</span></div>`).join('')}<div class="value-total"><span class="value-total-label">Total Value</span><span class="value-total-price">${c.total_value||'$1,997+'}</span></div></div><div style="margin-top:28px"><p style="font-size:15px;color:#5a6480;margin-bottom:20px">Get everything above when you join today</p><button class="btn-primary" data-optin>${c.cta||'Get Instant Access'} ${ARROW}</button><p class="cta-note">${c.cta_note||'Risk-free. Cancel anytime.'}</p></div></div></section>`
    : `<section class="section section-mid text-center"><div class="container"><div class="eyebrow">What You Get</div><h2 class="headline headline-lg" style="margin-bottom:12px">${c.features_headline||'Everything you need to succeed'}</h2><div class="divider"></div><div class="features-grid" style="margin-top:8px">${(c.features||[]).map(f=>`<div class="feature-card"><div class="feature-icon">${f.icon||'✓'}</div><div class="feature-title">${f.title||''}</div><div class="feature-desc">${f.desc||''}</div></div>`).join('')}</div></div></section>`;

  const guaranteeSection = () => c.guarantee
    ? `<section class="section section-dark text-center"><div class="container"><div class="guarantee-box"><div class="guarantee-icon">🛡️</div><div><h3 class="guarantee-title">${c.guarantee.headline||'Our Guarantee'}</h3><p class="guarantee-body">${c.guarantee.body||''}</p></div></div></div></section>`
    : '';

  const urgencySection = () => `<section class="section section-dark text-center"><div class="container"><div class="urgency-bar"><span class="urgency-icon">⏰</span><div><div class="urgency-text">Limited availability — spots filling fast</div><div class="urgency-sub">Join now to lock in your access before this closes</div></div></div><div style="margin-top:40px"><button class="btn-primary" data-optin>${c.cta||'Get Instant Access Now'} ${ARROW}</button><p class="cta-note">${c.cta_note||''}</p></div></div></section>`;

  const MODAL = (formHeadline, ctaText, ctaNote, redirectUrl='#') => `
<div id="modal-overlay" class="modal-overlay" role="dialog" aria-modal="true">
  <div class="modal">
    <button id="modal-close-btn" class="modal-close" aria-label="Close">×</button>
    <div class="modal-step">Step 1 of 1</div>
    <h2 class="modal-title">${formHeadline||'Get Instant Access'}</h2>
    <p class="modal-sub">Enter your details and get access immediately.</p>
    <div class="modal-divider"></div>
    <div class="field-wrap"><label class="field-label" for="f-name">First Name</label><input id="f-name" class="field" type="text" placeholder="Your first name" autocomplete="given-name"></div>
    <div class="field-wrap" style="margin-bottom:20px"><label class="field-label" for="f-email">Email Address</label><input id="f-email" class="field" type="email" placeholder="your@email.com" autocomplete="email"></div>
    <button id="modal-submit-btn" class="btn-primary" style="width:100%">${ctaText||'Get Free Access'} ${ARROW}</button>
    <p class="cta-note">${ctaNote||'Free. No credit card needed. Unsubscribe anytime.'}</p>
  </div>
</div>`;

  const STICKY_BAR = (ctaText) => `
<div id="sticky-bar" class="sticky-bar">
  <span class="sticky-text">🔥 <strong>${c.headline||'Free Training'}</strong> — Limited spots available</span>
  <button class="btn-primary" data-optin style="padding:14px 36px;font-size:14px">${ctaText||'Get Access Now'} ${ARROW}</button>
</div>`;

  const BASE_JS = (redirectUrl='#') => `
<script>
(function(){
  // Modal
  var overlay = document.getElementById('modal-overlay');
  function openModal(){
    if(!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow='hidden';
    setTimeout(function(){var f=overlay.querySelector('.field');if(f)f.focus();},320);
  }
  function closeModal(){
    overlay.classList.remove('open');
    document.body.style.overflow='';
  }
  document.querySelectorAll('[data-optin]').forEach(function(el){el.addEventListener('click',openModal);});
  if(overlay){
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeModal();});
    document.getElementById('modal-close-btn').addEventListener('click',closeModal);
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});

  // Form submit
  var submitBtn = document.getElementById('modal-submit-btn');
  if(submitBtn){
    submitBtn.addEventListener('click',function(){
      var name  = (document.getElementById('f-name') ||{value:''}).value.trim();
      var email = (document.getElementById('f-email')||{value:''}).value.trim();
      if(!email){var ef=document.getElementById('f-email');if(ef){ef.style.borderColor='rgba(239,68,68,.5)';ef.focus();}return;}
      submitBtn.textContent='Sending…';submitBtn.disabled=true;
      // Capture lead in parent window if inside iframe
      try{if(window.parent&&window.parent.captureEOSLead)window.parent.captureEOSLead(name,email);}catch(e){}
      setTimeout(function(){
        closeModal();
        if('${redirectUrl}'!=='#'){window.location.href='${redirectUrl}';}
        else{submitBtn.textContent='Access Granted ✓';submitBtn.style.background='linear-gradient(135deg,#22c55e,#16a34a)';}
      },800);
    });
  }

  // Sticky bar
  var stickyBar = document.getElementById('sticky-bar');
  if(stickyBar){
    window.addEventListener('scroll',function(){
      var heroH = (document.getElementById('hero-section')||{}).offsetHeight||400;
      stickyBar.classList.toggle('visible', window.scrollY > heroH * 0.7);
    },{passive:true});
  }

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(function(item){
    item.addEventListener('click',function(){
      var wasOpen=item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open');});
      if(!wasOpen)item.classList.add('open');
    });
  });
})();
</script>`;

  // ACTIVE_THEME is selected per-request inside the handler (where the
  // request's intelContext exists) and stored in the module-level variable
  // below. Referencing `ic` here at module scope was a ReferenceError that
  // 500'd every funnel generation.
  const HEAD = (title) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${title||'Free Training'}</title><style>${CSS}
${THEME_CSS[ACTIVE_THEME] || ''}</style></head><body>`;

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-IN PAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (mode === 'optin') {
    const redirectUrl = c.cta_url || '#';
    return HEAD(c.headline||'Free Training') + `
${ticker()}

<!-- HERO -->
<section class="section section-dark text-center" id="hero-section" style="position:relative;overflow:hidden;padding-bottom:0">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:20px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 44px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <button class="btn-primary" data-optin style="margin-bottom:14px">${c.cta||'Get Free Access Now'} ${ARROW}</button>
    <p class="cta-note">${c.cta_note||'Free. No credit card needed.'}</p>
    <div class="hero-line"></div>
  </div>
</section>

<!-- PROOF BAR -->
${c.proof_bar&&c.proof_bar.length?proofBar(c.proof_bar):''}

<!-- WHO THIS IS FOR -->
${c.for_yes&&c.for_yes.length?`
<section class="section section-alt text-center">
  <div class="container">
    <div class="eyebrow">Is This For You?</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">This is for you if…</h2>
    <div class="divider"></div>
    <div class="for-grid" style="margin-top:8px;max-width:640px;margin-left:auto;margin-right:auto">
      <div class="for-card for-card-yes"><div class="for-title for-title-yes">✅ This IS for you</div><ul class="for-list">${(c.for_yes||[]).map(i=>`<li><span class="icon">✓</span>${i}</li>`).join('')}</ul></div>
      <div class="for-card for-card-no"><div class="for-title for-title-no">❌ This is NOT for you</div><ul class="for-list">${(c.for_no||[]).map(i=>`<li><span class="icon">✗</span>${i}</li>`).join('')}</ul></div>
    </div>
  </div>
</section>`:''}

<!-- WHAT YOU GET -->
${(c.features&&c.features.length)?valueStack(c.features):''}

<!-- SOCIAL PROOF -->
${c.testimonials&&c.testimonials.length?`
<section class="section section-dark text-center">
  <div class="container-wide">
    <div class="eyebrow">Real Results</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">They did it. So can you.</h2>
    <div class="divider"></div>
    <div style="margin-top:8px">${testimonials(c.testimonials)}</div>
    <div style="margin-top:44px"><button class="btn-primary" data-optin>${c.cta||'Get Free Access Now'} ${ARROW}</button></div>
  </div>
</section>`:''}

${faqSection(c.faq)}
${urgencySection()}

<!-- FINAL CTA -->
<section class="section section-mid text-center">
  <div class="container">
    <div class="eyebrow">Don't Wait</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">${c.final_cta_headline||'Ready to get started?'}</h2>
    ${c.final_cta_sub?`<p class="subline" style="margin:0 auto 36px">${c.final_cta_sub}</p>`:'<div style="height:32px"></div>'}
    <button class="btn-primary" data-optin style="margin-bottom:14px">${c.cta||'Get Free Access Now'} ${ARROW}</button>
    <p class="cta-note">${c.cta_note||'Free. No credit card needed.'}</p>
  </div>
</section>

${MODAL(c.form_headline,c.cta,c.cta_note,redirectUrl)}
${STICKY_BAR(c.cta)}
${BASE_JS(redirectUrl)}
</body></html>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VSL PAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (mode === 'vsl') {
    const redirectUrl = c.cta_url || '#';
    return HEAD(c.headline||'Free Training') + `
${ticker()}

<!-- HERO -->
<section class="section section-dark text-center" id="hero-section" style="position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:18px">${c.headline||'Your Free Training'}</h1>
    <p class="subline" style="margin:0 auto 32px">${c.subheadline||''}</p>

    <!-- Video Player -->
    <div class="video-wrap">
      <div class="video-play">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="video-viewers">👁 Watching with <span>${c.video_viewers||'1,247'} others</span> right now</div>
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(78,204,163,.03),transparent 70%);pointer-events:none"></div>
    </div>
    ${c.video_note?`<p style="font-size:13px;color:#4a5268;margin-top:16px">${c.video_note}</p>`:''}
  </div>
</section>

<!-- PROOF BAR -->
${c.proof_bar&&c.proof_bar.length?proofBar(c.proof_bar):''}

<!-- BELOW FOLD COPY + CTA -->
<section class="section section-alt text-center">
  <div class="container">
    ${c.copy_headline?`<div class="eyebrow">What You Just Learned</div><h2 class="headline headline-lg" style="margin-bottom:12px">${c.copy_headline}</h2><div class="divider"></div>`:''}
    ${c.copy_body?`<p class="subline" style="margin:0 auto 32px">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 44px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <button class="btn-primary" data-optin style="margin-bottom:14px">${c.cta||'Book Your Free Call'} ${ARROW}</button>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>

<!-- TESTIMONIALS -->
${c.testimonials&&c.testimonials.length?`
<section class="section section-dark text-center">
  <div class="container-wide">
    <div class="eyebrow">People Are Getting Results</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">This changes everything for the right person</h2>
    <div class="divider"></div>
    <div style="margin-top:8px">${testimonials(c.testimonials)}</div>
    <div style="margin-top:44px"><button class="btn-primary" data-optin>${c.cta||'Book Your Free Call'} ${ARROW}</button></div>
  </div>
</section>`:''}

${guaranteeSection()}
${faqSection(c.faq)}
${urgencySection()}

${MODAL(c.form_headline,c.cta,c.cta_note,redirectUrl)}
${STICKY_BAR(c.cta)}
${BASE_JS(redirectUrl)}
</body></html>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOKING / APPLY PAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (mode === 'booking') {
    return HEAD(c.headline||'Book Your Call') + `
${ticker()}

<!-- HERO -->
<section class="section section-dark text-center" id="hero-section" style="position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:20px">${c.headline||'Book Your Free Strategy Call'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:500px;margin:0 auto;text-align:left">${bullets(c.bullets)}</div>`:''}
  </div>
</section>

<!-- WHAT HAPPENS ON THE CALL -->
${c.call_steps&&c.call_steps.length?`
<section class="section section-alt text-center">
  <div class="container">
    <div class="eyebrow">On Your Call</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">Here is exactly what we will cover</h2>
    <div class="divider"></div>
    <div class="steps-grid" style="margin-top:8px">${(c.call_steps||[]).map((s,i)=>`<div class="step-card"><div class="step-num">${i+1}</div><div><div class="step-title">${s.title||''}</div><div class="step-body">${s.body||''}</div></div></div>`).join('')}</div>
  </div>
</section>`:''}

<!-- CALENDAR EMBED -->
<section class="section section-mid text-center">
  <div class="container">
    <div class="eyebrow">Pick Your Time</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">${c.calendar_headline||'Choose a time that works for you'}</h2>
    <div class="divider"></div>
    <div id="calendly-placeholder" style="background:#08081a;border:2px dashed rgba(78,204,163,.1);border-radius:18px;min-height:580px;display:flex;align-items:center;justify-content:center;padding:3rem;margin-top:8px">
      <div style="text-align:center">
        <div style="font-size:48px;margin-bottom:16px">📅</div>
        <p style="color:#4a5268;font-size:14px;line-height:2">Replace this placeholder with your Calendly embed.<br><span style="color:#3a3a5a;font-size:12px">Paste your &lt;iframe src="https://calendly.com/..."&gt; here.</span></p>
      </div>
    </div>
  </div>
</section>

<!-- SOCIAL PROOF -->
${c.testimonials&&c.testimonials.length?`
<section class="section section-dark text-center">
  <div class="container-wide">
    <div class="eyebrow">What Others Said</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">People who took the call</h2>
    <div class="divider"></div>
    <div style="margin-top:8px">${testimonials(c.testimonials)}</div>
  </div>
</section>`:''}

${guaranteeSection()}
${faqSection(c.faq)}

<script>document.querySelectorAll('.faq-item').forEach(function(i){i.addEventListener('click',function(){var o=i.classList.contains('open');document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open');});if(!o)i.classList.add('open');});});</script>
</body></html>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRIDGE / PRESELL PAGE
  // ══════════════════════════════════════════════════════════════════════════
  const redirectUrl = c.cta_url || '#';
  return HEAD(c.headline||'One Thing Before You Go') + `
${ticker()}

<!-- HERO -->
<section class="section section-dark text-center" id="hero-section" style="position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:20px">${c.headline||'Before You Leave'}</h1>
    <p class="subline" style="margin:0 auto 32px">${c.subheadline||''}</p>
    ${c.copy_body?`<p style="font-size:16px;color:#7a85a8;max-width:580px;margin:0 auto 36px;line-height:1.85">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 44px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <a class="btn-primary" href="${redirectUrl}" target="_blank" rel="noopener" style="margin-bottom:14px">${c.cta||'See What I Recommend'} ${ARROW}</a>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>

${c.proof_bar&&c.proof_bar.length?proofBar(c.proof_bar):''}

${c.testimonials&&c.testimonials.length?`
<section class="section section-alt text-center">
  <div class="container-wide">
    <div class="eyebrow">Real Results</div>
    <h2 class="headline headline-lg" style="margin-bottom:12px">Others are already seeing results</h2>
    <div class="divider"></div>
    <div style="margin-top:8px">${testimonials(c.testimonials)}</div>
    <div style="margin-top:44px"><a class="btn-primary" href="${redirectUrl}" target="_blank" rel="noopener">${c.cta||'Get Access Now'} ${ARROW}</a></div>
  </div>
</section>`:''}

${faqSection(c.faq)}
${urgencySection()}

<script>document.querySelectorAll('.faq-item').forEach(function(i){i.addEventListener('click',function(){var o=i.classList.contains('open');document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open');});if(!o)i.classList.add('open');});});</script>
</body></html>`;
}
