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

  const { prompt, max_tokens, mode, boardroomIntel, userContext } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const bi  = boardroomIntel || null;
  const uc  = userContext    || {};

  // ── BUILD THE SYSTEM PROMPT ────────────────────────────────────────────────
  // When Boardroom intel is available, the AI is instructed to USE it as the
  // foundation — not invent positioning or copy from scratch.
  const BOARDROOM_BLOCK = bi ? `
═══════════════════════════════════════════════════════
BOARDROOM INTELLIGENCE — USE THIS AS YOUR FOUNDATION
This data comes from live market research and the user's
exact situation. Every piece of copy you write MUST be
grounded in this intelligence. Do NOT invent positioning
or avatar language from scratch.
═══════════════════════════════════════════════════════

OFFER & MARKET CONTEXT:
  Niche:              ${uc.niche         || ''}
  Offer Name:         ${uc.offerName     || ''}
  Price:              $${uc.price        || ''}
  Monthly Target:     $${uc.target       || ''}
  Platform:           ${uc.platform      || ''}
  Audience Size:      ${uc.audience      || ''}

AVATAR INTELLIGENCE (use their EXACT language):
  Core Pain:          ${uc.av_pain       || bi.mentorNote || ''}
  Deepest Fear:       ${uc.av_fear       || ''}
  Transformation:     ${uc.transformation|| ''}
  Key Objections:     ${uc.av_objections || ''}

MARKET POSITIONING (already validated against live research):
  Positioning:        ${bi.positioningStatement || ''}
  Dominance Angle:    ${bi.dominanceAngle       || ''}
  Unique Mechanism:   ${bi.uniqueMechanism      || ''}
  Market Gap Found:   ${bi.marketGapFound       || ''}
  Category to Own:    ${bi.categoryDesign       || ''}
  Target Customer:    ${bi.targetCustomerSentence|| ''}
  Offer Framing:      ${bi.offerPositioning     || ''}

PROVEN COPY ASSETS (use or adapt these — do NOT ignore them):
  Headlines:          ${(bi.headlines || []).join(' | ')}
  VSL Opener:         ${bi.vslOpener            || ''}
  Closing Script:     ${bi.closingScript        || ''}
  DM Openers:         ${(bi.dmOpeners || []).join(' | ')}
  Content Hooks:      ${(bi.week1ContentHooks || []).join(' | ')}
  Email Subjects:     ${(bi.emailSubjects || []).join(' | ')}
  Content Pillars:    ${(bi.contentPillars || []).join(' | ')}

MENTOR INTELLIGENCE:
  ${bi.mentorNote || ''}
  Biggest Risk:       ${bi.biggestRisk       || ''}
  Success Condition:  ${bi.successCondition  || ''}

REVENUE MATH:
  Sales needed:       ${(bi.revenueBreakdown || {}).salesNeeded || ''} sales
  Weekly target:      ${(bi.revenueBreakdown || {}).weeklySalesTarget || ''}

═══════════════════════════════════════════════════════
INSTRUCTIONS FOR USING THIS INTELLIGENCE:
1. The headline MUST be adapted from the Boardroom headlines above
2. The subheadline MUST name the exact target customer sentence
3. Bullets MUST use the avatar's exact pain/fear language
4. Proof bar numbers MUST feel congruent with the niche (use real-looking numbers)
5. Testimonials MUST reflect the transformation and market positioning
6. The badge MUST reflect the unique mechanism or category
7. CTAs MUST reflect the offer name and transformation
8. Every sentence should feel like it was written specifically for this person's audience
═══════════════════════════════════════════════════════
` : '';

  const SYSTEM = `You are the world's best direct-response copywriter and funnel strategist embedded inside Execution-OS — a 9-figure digital product platform. You write copy that converts at 40-60% because you combine live market intelligence with deep avatar psychology.
${BOARDROOM_BLOCK}
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
        model:      'claude-sonnet-4-20250514',
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
    catch(e) { return res.status(200).json({ content: [{ type: 'text', text }], model: 'claude-sonnet-4-20250514' }); }

    const html = renderTemplate(copy, mode || 'optin');
    return res.status(200).json({ content: [{ type: 'text', text: html }], model: 'claude-sonnet-4-20250514' });

  } catch(e) {
    console.error('generate-funnel:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
function renderTemplate(c, mode) {

  const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Poppins:ital,wght@0,700;0,800;0,900;1,800&display=swap" rel="stylesheet">`;

  const CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{background:#060610;color:#c0c8e0;font-family:'Inter',sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;overflow-x:hidden}
    img{max-width:100%;display:block}a{text-decoration:none}em{font-style:italic}

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

    .cta-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#4ecca3 0%,#38b88e 100%);color:#040408;font-family:'Poppins',sans-serif;font-weight:900;font-size:15px;letter-spacing:.3px;padding:18px 52px;border-radius:10px;border:none;cursor:pointer;text-align:center;transition:all .25s;box-shadow:0 0 50px rgba(78,204,163,.2),0 4px 24px rgba(0,0,0,.5);text-transform:uppercase;white-space:nowrap}
    .cta-btn:hover{transform:translateY(-3px);box-shadow:0 0 80px rgba(78,204,163,.35),0 12px 36px rgba(0,0,0,.6)}
    .cta-btn:active{transform:translateY(-1px)}
    .cta-btn svg{width:18px;height:18px;flex-shrink:0}
    .cta-note{font-size:11px;color:#3a3a5c;margin-top:12px;text-align:center;letter-spacing:.3px}

    .modal-overlay{position:fixed;inset:0;background:rgba(4,4,12,.92);backdrop-filter:blur(10px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .3s}
    .modal-overlay.open{opacity:1;pointer-events:all}
    .modal{background:#0e0e22;border:1px solid rgba(78,204,163,.15);border-radius:20px;padding:40px 36px;max-width:440px;width:100%;position:relative;transform:scale(.92) translateY(20px);transition:all .3s cubic-bezier(.34,1.56,.64,1)}
    .modal-overlay.open .modal{transform:scale(1) translateY(0)}
    .modal-close{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#6b7280;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s}
    .modal-close:hover{background:rgba(255,255,255,.1);color:#fff}
    .modal-step{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4ecca3;margin-bottom:6px}
    .modal-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:22px;color:#fff;line-height:1.2;margin-bottom:6px}
    .modal-sub{font-size:13px;color:#6b7280;margin-bottom:24px;line-height:1.6}
    .modal-divider{height:1px;background:rgba(255,255,255,.05);margin:0 -36px 24px}

    .field{width:100%;background:#070712;border:1.5px solid rgba(255,255,255,.07);border-radius:10px;padding:14px 16px;color:#fff;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:all .2s;-webkit-appearance:none}
    .field:focus{border-color:rgba(78,204,163,.45);background:#0a0a18;box-shadow:0 0 0 3px rgba(78,204,163,.08)}
    .field::placeholder{color:#2e2e50}
    .field-label{font-size:11px;font-weight:600;color:#4a4a70;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;display:block}
    .field-group{display:flex;flex-direction:column;gap:4px}

    .bullets{list-style:none;display:flex;flex-direction:column;gap:16px}
    .bullets li{display:flex;align-items:flex-start;gap:14px;font-size:15px;color:#a0aac0;line-height:1.6}
    .check-wrap{width:22px;height:22px;border-radius:50%;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
    .check-wrap svg{width:10px;height:10px}

    .proof-bar{display:flex;justify-content:center;gap:0;flex-wrap:wrap}
    .proof-item{text-align:center;padding:24px 32px;position:relative}
    .proof-item:not(:last-child)::after{content:'';position:absolute;right:0;top:50%;transform:translateY(-50%);height:40px;width:1px;background:rgba(255,255,255,.06)}
    .proof-num{font-family:'Poppins',sans-serif;font-weight:900;font-size:30px;color:#fff;line-height:1;letter-spacing:-1px}
    .proof-label{font-size:11px;color:#5a6480;margin-top:4px;font-weight:500;letter-spacing:.3px}

    .testi-card{background:#0e0e22;border:1px solid rgba(255,255,255,.05);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:12px}
    .testi-stars{color:#f0c040;font-size:13px;letter-spacing:3px}
    .testi-quote{font-size:14px;color:#9098b5;line-height:1.75;font-style:italic}
    .testi-author{display:flex;align-items:center;gap:10px;margin-top:4px}
    .testi-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4ecca3,#7b6ff0);display:flex;align-items:center;justify-content:center;font-family:'Poppins',sans-serif;font-weight:800;font-size:13px;color:#040408;flex-shrink:0}
    .testi-name{font-size:13px;font-weight:700;color:#fff}
    .testi-result{font-size:11px;color:#4ecca3;font-weight:600;letter-spacing:.3px}

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
    .sticky-text{font-size:13px;color:#7a85a8;font-weight:500}
    .sticky-text strong{color:#fff}

    @media(max-width:640px){
      .section{padding:60px 0}.container{padding:0 18px}
      .cta-btn{width:100%;padding:17px 24px}
      .proof-item{padding:20px 16px}.proof-num{font-size:24px}
      .modal{padding:32px 24px}.modal-divider{margin:0 -24px 20px}
      .sticky-bar{flex-direction:column;gap:10px;padding:16px}.sticky-bar .cta-btn{width:100%}
      .sticky-text{display:none}
    }
  `;

  const ARROW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  const CHECK_ICON = `<svg viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#4ecca3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const POPUP_JS = (redirectUrl) => `<script>
(function(){
  var overlay = document.getElementById('modal-overlay');
  function openModal(){
    overlay.classList.add('open');
    document.body.style.overflow='hidden';
    setTimeout(function(){ var f=overlay.querySelector('.field'); if(f)f.focus(); },320);
  }
  function closeModal(){
    overlay.classList.remove('open');
    document.body.style.overflow='';
  }
  document.querySelectorAll('[data-optin]').forEach(function(el){ el.addEventListener('click',openModal); });
  overlay.addEventListener('click',function(e){ if(e.target===overlay)closeModal(); });
  document.getElementById('modal-close-btn').addEventListener('click',closeModal);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')closeModal(); });
  var form=document.getElementById('modal-form');
  if(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var email=document.getElementById('modal-email').value.trim();
      var name=document.getElementById('modal-name').value.trim();
      if(!email||!email.includes('@')){
        document.getElementById('modal-email').style.borderColor='rgba(255,80,80,.5)';
        return;
      }
      var btn=form.querySelector('.cta-btn');
      btn.innerHTML='Processing...';btn.style.opacity='.7';
      if(window.captureEOSLead)window.captureEOSLead(email,name);
      setTimeout(function(){ window.location.href='${redirectUrl}'; },500);
    });
  }
  var stickyBar=document.getElementById('sticky-bar');
  if(stickyBar){
    var heroBottom=0;
    window.addEventListener('scroll',function(){
      if(!heroBottom){ var hero=document.getElementById('hero-section'); if(hero)heroBottom=hero.getBoundingClientRect().bottom+window.scrollY; }
      if(window.scrollY>heroBottom-80)stickyBar.classList.add('visible');
      else stickyBar.classList.remove('visible');
    },{passive:true});
  }
  document.querySelectorAll('.faq-item').forEach(function(item){
    item.addEventListener('click',function(){
      var isOpen=item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function(o){ o.classList.remove('open'); });
      if(!isOpen)item.classList.add('open');
    });
  });
})();
</script>`;

  const MODAL = (formHeadline, ctaText, ctaNote) => `
<div class="modal-overlay" id="modal-overlay">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <button class="modal-close" id="modal-close-btn" aria-label="Close">&#x2715;</button>
    <p class="modal-step">Step 1 of 2 &mdash; Get Access</p>
    <h3 class="modal-title" id="modal-title">${formHeadline || 'Get Instant Access Below'}</h3>
    <p class="modal-sub">Enter your details and we'll send everything right away.</p>
    <div class="modal-divider"></div>
    <form id="modal-form" novalidate>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="field-group">
          <label class="field-label" for="modal-name">First Name</label>
          <input class="field" id="modal-name" type="text" placeholder="e.g. Sarah" autocomplete="given-name"/>
        </div>
        <div class="field-group">
          <label class="field-label" for="modal-email">Email Address</label>
          <input class="field" id="modal-email" type="email" placeholder="you@example.com" required autocomplete="email"/>
        </div>
        <button type="submit" class="cta-btn" style="width:100%;margin-top:4px;justify-content:center">
          ${ctaText || 'Get Instant Access'}
          ${ARROW_ICON}
        </button>
        <p class="cta-note">${ctaNote || 'Free. No spam. No credit card required.'}</p>
      </div>
    </form>
  </div>
</div>`;

  const STICKY_BAR = (ctaText) => `
<div class="sticky-bar" id="sticky-bar">
  <p class="sticky-text">Spots are filling fast &mdash; <strong>don't miss out.</strong></p>
  <button class="cta-btn" style="padding:14px 36px;font-size:13px" data-optin>
    ${ctaText || 'Get Free Access'}
    ${ARROW_ICON}
  </button>
</div>`;

  const bullets = (arr) => !arr?.length ? '' :
    `<ul class="bullets">${arr.map(b =>
      `<li><div class="check-wrap">${CHECK_ICON}</div><span>${b}</span></li>`
    ).join('')}</ul>`;

  const testimonials = (arr) => !arr?.length ? '' :
    arr.map(t => {
      const init = (t.name||'A').charAt(0).toUpperCase();
      return `<div class="testi-card">
        <div class="testi-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <p class="testi-quote">"${t.quote}"</p>
        <div class="testi-author">
          <div class="testi-avatar">${init}</div>
          <div>
            <p class="testi-name">${t.name}</p>
            ${t.result ? `<p class="testi-result">&#10022; ${t.result}</p>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

  const proofBar = (arr) => !arr?.length ? '' :
    `<div class="proof-bar">${arr.map(p =>
      `<div class="proof-item">
        <div class="proof-num grad">${p.num}</div>
        <div class="proof-label">${p.label}</div>
      </div>`
    ).join('')}</div>`;

  const ticker = () => {
    const items = [
      c.social_proof || '2,847 people joined this week',
      c.result_stat  || 'Average member sees results in 30 days',
      c.trust_line   || '100% free to get started today',
    ].map(i => `<span class="ticker-item">${i}<span class="ticker-sep">&#10022;</span></span>`).join('');
    return `<div class="ticker-wrap"><div class="ticker-inner" aria-hidden="true">${items}${items}${items}</div></div>`;
  };

  const faqSection = (arr) => !arr?.length ? '' : `
<section class="section section-mid">
  <div class="container" style="text-align:center">
    <p class="label-tag" style="margin-bottom:8px">Questions Answered</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.faq_headline || 'Common Questions'}</h2>
    <div class="divider"></div>
    <div style="display:flex;flex-direction:column;gap:8px;text-align:left;margin-top:8px">
      ${arr.map(f => `
      <div class="faq-item">
        <div class="faq-q">
          <span class="faq-q-text">${f.q}</span>
          <div class="faq-icon"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="#4ecca3" stroke-width="1.5" stroke-linecap="round"/></svg></div>
        </div>
        <div class="faq-a"><p>${f.a}</p></div>
      </div>`).join('')}
    </div>
  </div>
</section>`;

  // ── OPT-IN PAGE ─────────────────────────────────────────────────────────────
  if (mode === 'optin' || mode === 'landing' || mode === 'lead') {
    const redirectUrl = c.cta_url || '?page=vsl';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Free Training'}</title><style>${CSS}</style></head><body>
${ticker()}
<section class="section section-dark" id="hero-section" style="position:relative;overflow:hidden;padding-top:96px;padding-bottom:96px;text-align:center">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:20px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 40px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 44px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <button class="cta-btn" data-optin style="margin-bottom:12px">${c.cta||'Get Free Access Now'}${ARROW_ICON}</button>
    <p class="cta-note">${c.cta_note||'Free. No credit card required.'}</p>
  </div>
</section>

${c.proof_bar&&c.proof_bar.length?`<div style="background:#0b0b1a;border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04)"><div class="container">${proofBar(c.proof_bar)}</div></div>`:''}

${c.testimonials&&c.testimonials.length?`
<section class="section section-alt">
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
    <button class="cta-btn" data-optin style="margin-bottom:12px">${c.cta||'Get Free Access Now'}${ARROW_ICON}</button>
    <p class="cta-note">${c.cta_note||'Free. No credit card required.'}</p>
  </div>
</section>

${MODAL(c.form_headline,c.cta,c.cta_note)}
${STICKY_BAR(c.cta)}
${POPUP_JS(redirectUrl)}
</body></html>`;
  }

  // ── VSL PAGE ─────────────────────────────────────────────────────────────────
  if (mode === 'vsl') {
    const redirectUrl = c.cta_url || '#';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Free Training'}</title><style>${CSS}</style></head><body>
${ticker()}
<section class="section section-dark" id="hero-section" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:18px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    <div style="background:#080816;border:1px solid rgba(78,204,163,.1);border-radius:16px;overflow:hidden;aspect-ratio:16/9;max-width:700px;margin:0 auto;display:flex;align-items:center;justify-content:center;position:relative">
      <div style="text-align:center;z-index:1">
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(78,204,163,.08);border:1.5px solid rgba(78,204,163,.2);display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#4ecca3"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <p style="color:#4a4a6a;font-size:13px">Paste your video embed code here</p>
      </div>
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(78,204,163,.04),transparent 70%);pointer-events:none"></div>
    </div>
    ${c.video_note?`<p style="font-size:12px;color:#3a3a5c;margin-top:12px">${c.video_note}</p>`:''}
  </div>
</section>

<section class="section section-alt" style="text-align:center">
  <div class="container">
    ${c.copy_headline?`<h2 class="headline headline-lg" style="margin-bottom:8px">${c.copy_headline}</h2><div class="divider"></div>`:''}
    ${c.copy_body?`<p style="font-size:16px;color:#7a85a8;max-width:580px;margin:0 auto 36px;line-height:1.85">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 40px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <button class="cta-btn" data-optin style="margin-bottom:12px">${c.cta||'Get Instant Access Now'}${ARROW_ICON}</button>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>

${c.proof_bar&&c.proof_bar.length?`<div style="background:#060610;border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04)"><div class="container">${proofBar(c.proof_bar)}</div></div>`:''}

${c.testimonials&&c.testimonials.length?`
<section class="section section-mid">
  <div class="container" style="text-align:center">
    <p class="label-tag" style="margin-bottom:8px">Results</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">People are getting results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
    <div style="text-align:center;margin-top:44px">
      <button class="cta-btn" data-optin>${c.cta||'Get Instant Access Now'}${ARROW_ICON}</button>
    </div>
  </div>
</section>`:''}

${faqSection(c.faq)}
${MODAL(c.form_headline,c.cta,c.cta_note)}
${STICKY_BAR(c.cta)}
${POPUP_JS(redirectUrl)}
</body></html>`;
  }

  // ── BOOKING PAGE ─────────────────────────────────────────────────────────────
  if (mode === 'booking' || mode === 'apply') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Book Your Call'}</title><style>${CSS}</style></head><body>
${ticker()}
<section class="section section-dark" id="hero-section" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:18px">${c.headline||'Book Your Free Strategy Call'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:480px;margin:0 auto;text-align:left">${bullets(c.bullets)}</div>`:''}
  </div>
</section>
<section class="section section-alt">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.calendar_headline||'Pick a time that works for you'}</h2>
    <div class="divider"></div>
    <div style="background:#07070f;border:1.5px dashed rgba(78,204,163,.12);border-radius:16px;min-height:560px;display:flex;align-items:center;justify-content:center;padding:3rem;margin-top:8px">
      <div style="text-align:center"><div style="font-size:40px;margin-bottom:16px">&#128197;</div><p style="color:#4a4a6a;font-size:14px;line-height:2">Paste your Calendly embed here.<br><span style="color:#3a3a5c;font-size:12px">Replace this with your &lt;iframe&gt; or script.</span></p></div>
    </div>
  </div>
</section>
${c.guarantee?`<section class="section section-dark"><div class="container" style="text-align:center;max-width:520px"><div style="font-size:48px;margin-bottom:16px">&#129336;</div><h2 class="headline headline-md" style="margin-bottom:10px">${c.guarantee.headline||''}</h2><p style="font-size:15px;color:#7a85a8;line-height:1.75">${c.guarantee.body||''}</p></div></section>`:''}
${faqSection(c.faq)}
<script>document.querySelectorAll('.faq-item').forEach(function(i){i.addEventListener('click',function(){var o=i.classList.contains('open');document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open')});if(!o)i.classList.add('open')});});</script>
</body></html>`;
  }

  // ── BRIDGE PAGE ───────────────────────────────────────────────────────────────
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Special Offer'}</title><style>${CSS}</style></head><body>
${ticker()}
<section class="section section-dark" id="hero-section" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge"><span class="badge-dot"></span>${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:18px">${c.headline||'One Thing Before You Go'}</h1>
    <p class="subline" style="margin:0 auto 32px">${c.subheadline||''}</p>
    ${c.copy_body?`<p style="font-size:15px;color:#7a85a8;max-width:560px;margin:0 auto 32px;line-height:1.85">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:500px;margin:0 auto 40px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <a class="cta-btn" href="${c.cta_url||'#'}" target="_blank" rel="noopener" style="margin-bottom:12px">${c.cta||'See What I Recommend'}${ARROW_ICON}</a>
    <p class="cta-note">${c.cta_note||''}</p>
  </div>
</section>
${c.testimonials&&c.testimonials.length?`
<section class="section section-alt">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:8px">Others are already seeing results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
  </div>
</section>`:''}
<script>document.querySelectorAll('.faq-item').forEach(function(i){i.addEventListener('click',function(){var o=i.classList.contains('open');document.querySelectorAll('.faq-item.open').forEach(function(x){x.classList.remove('open')});if(!o)i.classList.add('open')});});</script>
</body></html>`;
}
