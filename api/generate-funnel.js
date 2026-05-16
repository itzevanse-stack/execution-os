// api/generate-funnel.js — Premium template-based funnel generation
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel.' });

  const { prompt, max_tokens, mode } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const SYSTEM = `You are the world's best direct-response copywriter.

RULES — Non-negotiable:
- Headline: MAX 8 words. Specific result or number. No fluff.
  RIGHT: "Make $3,000/Month Promoting Other People's Products"
  RIGHT: "Get 3 Paying Clients In The Next 30 Days"
  WRONG: "Discover The System That Will Transform Your Business"
- Subheadline: ONE sentence. Name the exact audience and exact outcome.
- Bullets: Lead with RESULT. "You will have..." never "Learn how to..."
- CTA: 3-5 words. Action + benefit. Never "Submit" or "Click Here".
- Zero hollow phrases. No dashes. No "game-changer". No "journey".
- Social proof numbers must feel real: "2,847 people" not "thousands of people"

Return ONLY valid JSON. No markdown. No backticks. No explanation.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: Math.min(max_tokens || 3000, 3000), system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json(e); }

    const d = await r.json();
    let text = (d.content?.[0]?.text || '').trim().replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```\s*$/,'').trim();

    let copy;
    try { copy = JSON.parse(text); } catch(e) { return res.status(200).json({ content:[{type:'text',text}], model:'claude-sonnet-4-20250514' }); }

    const html = renderTemplate(copy, mode || 'optin');
    return res.status(200).json({ content:[{type:'text',text:html}], model:'claude-sonnet-4-20250514' });
  } catch(e) {
    console.error('generate-funnel:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
function renderTemplate(c, mode) {
  const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@700;800;900&display=swap" rel="stylesheet">`;

  const CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{background:#07070f;color:#c8cde8;font-family:'Inter',sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
    img{max-width:100%;display:block}
    a{text-decoration:none}

    /* Layout */
    .container{max-width:680px;margin:0 auto;padding:0 24px}
    .section{padding:72px 0}
    .section-dark{background:#07070f}
    .section-mid{background:#0d0d1c}
    .section-card{background:#111127}

    /* Typography */
    .headline{font-family:'Poppins',sans-serif;font-weight:900;line-height:1.07;letter-spacing:-1.5px;color:#fff}
    .headline-xl{font-size:clamp(34px,5.5vw,58px)}
    .headline-lg{font-size:clamp(24px,4vw,40px)}
    .subline{font-size:18px;color:#8892b0;line-height:1.65;max-width:560px}
    .label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px}

    /* Badge */
    .badge{display:inline-flex;align-items:center;gap:6px;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.2);color:#4ecca3;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:20px}

    /* Ticker */
    .ticker-wrap{background:rgba(78,204,163,.05);border-bottom:1px solid rgba(78,204,163,.1);padding:9px 0;overflow:hidden;white-space:nowrap}
    .ticker-inner{display:inline-block;animation:ticker 28s linear infinite}
    .ticker-inner:hover{animation-play-state:paused}
    @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .ticker-item{display:inline-flex;align-items:center;gap:24px;padding:0 24px;font-size:12px;color:#6b7280;font-weight:500}
    .ticker-dot{width:4px;height:4px;border-radius:50%;background:#4ecca3;opacity:.6}

    /* Form */
    .form-card{background:#111127;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:32px;max-width:420px;margin:0 auto}
    .form-card .label{color:#6b7280;margin-bottom:16px;display:block}
    .field{width:100%;background:#07070f;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:13px 16px;color:#fff;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:border-color .15s}
    .field:focus{border-color:rgba(78,204,163,.4)}
    .field::placeholder{color:#3a3a5c}

    /* CTA Button */
    .cta{display:inline-block;background:linear-gradient(135deg,#4ecca3,#38b88e);color:#07070f;font-family:'Poppins',sans-serif;font-weight:900;font-size:15px;letter-spacing:.2px;padding:17px 48px;border-radius:8px;border:none;cursor:pointer;text-align:center;transition:transform .2s,box-shadow .2s;box-shadow:0 0 40px rgba(78,204,163,.25),0 4px 20px rgba(0,0,0,.4);text-transform:uppercase}
    .cta:hover{transform:translateY(-2px);box-shadow:0 0 60px rgba(78,204,163,.4),0 8px 28px rgba(0,0,0,.5)}
    .cta-wrap{text-align:center;margin-top:24px}
    .cta-note{font-size:11px;color:#4a4a6a;margin-top:10px;text-align:center}

    /* Bullets */
    .bullets{list-style:none;display:flex;flex-direction:column;gap:14px}
    .bullets li{display:flex;align-items:flex-start;gap:12px;font-size:15px;color:#b0b8d0;line-height:1.6}
    .check{width:20px;height:20px;border-radius:50%;background:rgba(78,204,163,.12);border:1px solid rgba(78,204,163,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
    .check svg{width:10px;height:10px}

    /* Cards */
    .card{background:#111127;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:24px}
    .card-teal{border-color:rgba(78,204,163,.12)}

    /* Stars */
    .stars{color:#f0c040;font-size:14px;letter-spacing:2px}

    /* Proof bar */
    .proof-bar{display:flex;justify-content:center;gap:40px;flex-wrap:wrap;padding:28px 0}
    .proof-item{text-align:center}
    .proof-num{font-family:'Poppins',sans-serif;font-weight:900;font-size:26px;color:#fff;line-height:1}
    .proof-label{font-size:11px;color:#6b7280;margin-top:3px}

    /* Highlight */
    .hl{background:linear-gradient(135deg,#4ecca3,#f0c040);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

    /* Glow */
    .hero-glow{position:absolute;top:-100px;left:50%;transform:translateX(-50%);width:700px;height:500px;background:radial-gradient(ellipse at center,rgba(78,204,163,.06) 0%,transparent 65%);pointer-events:none;z-index:0}

    /* Divider */
    .divider{width:48px;height:3px;background:linear-gradient(90deg,#4ecca3,#6c63ff);border-radius:2px;margin:16px auto 28px}

    @media(max-width:640px){
      .section{padding:52px 0}
      .container{padding:0 16px}
      .form-card{padding:24px}
      .cta{width:100%;padding:16px 24px}
      .proof-bar{gap:24px}
      .headline-xl{font-size:32px}
    }
  `;

  const bullets = (arr) => !arr?.length ? '' :
    `<ul class="bullets">${arr.map(b=>`<li><div class="check"><svg viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#4ecca3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span>${b}</span></li>`).join('')}</ul>`;

  const testimonials = (arr) => !arr?.length ? '' :
    arr.map(t=>`<div class="card card-teal"><div class="stars">★★★★★</div><p style="font-size:14px;color:#b0b8d0;margin:10px 0 12px;font-style:italic;line-height:1.7">"${t.quote}"</p><div style="font-size:12px;font-weight:600;color:#4ecca3">${t.name}</div></div>`).join('');

  const ticker = (items) => {
    const list = (items||[
      c.social_proof || '2,847 people joined this week',
      c.result_stat  || 'Average member sees results in 30 days',
      c.trust_line   || '100% free to get started today',
    ]).map(i=>`<span class="ticker-item">${i}<span class="ticker-dot"></span></span>`).join('');
    return `<div class="ticker-wrap"><div class="ticker-inner">${list}${list}</div></div>`;
  };

  const faq = (arr) => !arr?.length ? '' : `
    <div class="section section-mid">
      <div class="container" style="text-align:center">
        <p class="label" style="color:#4ecca3;margin-bottom:8px">Got questions?</p>
        <h2 class="headline headline-lg" style="margin-bottom:8px">${c.faq_headline||'Common Questions'}</h2>
        <div class="divider"></div>
        <div style="display:flex;flex-direction:column;gap:10px;text-align:left;margin-top:8px">
          ${arr.map(f=>`<div class="card"><p style="font-size:14px;font-weight:600;color:#fff;margin-bottom:6px">${f.q}</p><p style="font-size:13px;color:#8892b0">${f.a}</p></div>`).join('')}
        </div>
      </div>
    </div>`;

  // ── OPT-IN PAGE ─────────────────────────────────────────────────────────────
  if (mode === 'optin' || mode === 'landing' || mode === 'lead') {
    const redirectUrl = c.cta_url || '?page=vsl';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Free Training'}</title><style>${CSS}</style></head><body>
${ticker()}
<div class="section section-dark" style="position:relative;overflow:hidden;padding-top:88px;padding-bottom:88px;text-align:center">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge">✦ ${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:18px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:500px;margin:0 auto 40px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <div class="form-card">
      <p class="label" style="text-align:center">${c.form_headline||'Enter your details to get access'}</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <input class="field" id="ln" type="text" placeholder="First Name" />
        <input class="field" id="le" type="email" placeholder="Email Address" />
        <button class="cta" style="width:100%;margin-top:4px" onclick="if(!document.getElementById('le').value.includes('@')){alert('Enter your email');return;}if(window.captureEOSLead)window.captureEOSLead(document.getElementById('le').value,document.getElementById('ln').value);setTimeout(function(){window.location.href='${redirectUrl}';},400);">${c.cta||'Get Free Access Now'}</button>
        <p class="cta-note">${c.cta_note||'Free. No credit card needed.'}</p>
      </div>
    </div>
  </div>
</div>

${c.testimonials&&c.testimonials.length?`
<div class="section section-mid">
  <div class="container" style="text-align:center">
    <p class="label" style="color:#4ecca3;margin-bottom:8px">Real Results</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">Here's what people are saying</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
  </div>
</div>`:''}

${c.features&&c.features.length?`
<div class="section section-dark">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.features_headline||'What you get when you join'}</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:8px">
      ${c.features.map(f=>`<div class="card" style="text-align:center"><div style="font-size:26px;margin-bottom:8px">${f.icon||'✓'}</div><p style="font-weight:700;color:#fff;font-size:13px;margin-bottom:4px">${f.title}</p><p style="font-size:12px;color:#6b7280">${f.desc||''}</p></div>`).join('')}
    </div>
  </div>
</div>`:''}

${faq(c.faq)}

<div class="section section-mid">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:10px">${c.final_cta_headline||'Ready to get started?'}</h2>
    ${c.final_cta_sub?`<p class="subline" style="margin:0 auto 28px">${c.final_cta_sub}</p>`:'<div style="height:24px"></div>'}
    <div class="form-card">
      <div style="display:flex;flex-direction:column;gap:10px">
        <input class="field" id="ln2" type="text" placeholder="First Name" />
        <input class="field" id="le2" type="email" placeholder="Email Address" />
        <button class="cta" style="width:100%;margin-top:4px" onclick="if(!document.getElementById('le2').value.includes('@')){alert('Enter your email');return;}if(window.captureEOSLead)window.captureEOSLead(document.getElementById('le2').value,document.getElementById('ln2').value);setTimeout(function(){window.location.href='${redirectUrl}';},400);">${c.cta||'Get Free Access Now'}</button>
        <p class="cta-note">${c.cta_note||'Free. No credit card needed.'}</p>
      </div>
    </div>
  </div>
</div>
</body></html>`;
  }

  // ── VSL PAGE ─────────────────────────────────────────────────────────────────
  if (mode === 'vsl') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Free Training'}</title><style>${CSS}</style></head><body>
${ticker()}
<div class="section section-dark" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge">✦ ${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:16px">${c.headline||'Your Headline'}</h1>
    <p class="subline" style="margin:0 auto 36px">${c.subheadline||''}</p>
    <div style="background:#0a0a18;border:1px solid rgba(78,204,163,.12);border-radius:14px;overflow:hidden;aspect-ratio:16/9;max-width:680px;margin:0 auto;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.25);display:flex;align-items:center;justify-content:center;margin:0 auto 12px"><svg width="22" height="22" viewBox="0 0 24 24" fill="#4ecca3"><path d="M8 5v14l11-7z"/></svg></div><p style="color:#6b7280;font-size:13px">Your video goes here</p></div>
    </div>
    ${c.video_note?`<p style="font-size:12px;color:#4a4a6a;margin-top:10px">${c.video_note}</p>`:''}
  </div>
</div>

<div class="section section-mid">
  <div class="container" style="text-align:center">
    ${c.copy_headline?`<h2 class="headline headline-lg" style="margin-bottom:10px">${c.copy_headline}</h2><div class="divider"></div>`:''}
    ${c.copy_body?`<p style="font-size:16px;color:#8892b0;max-width:580px;margin:0 auto 32px;line-height:1.8">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:520px;margin:0 auto 36px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <div class="cta-wrap">
      <a class="cta" href="${c.cta_url||'#'}">${c.cta||'Get Instant Access Now'}</a>
      <p class="cta-note">${c.cta_note||''}</p>
    </div>
  </div>
</div>

${c.testimonials&&c.testimonials.length?`
<div class="section section-dark">
  <div class="container" style="text-align:center">
    <p class="label" style="color:#4ecca3;margin-bottom:8px">Results</p>
    <h2 class="headline headline-lg" style="margin-bottom:8px">People are getting results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
    <div class="cta-wrap" style="margin-top:40px"><a class="cta" href="${c.cta_url||'#'}">${c.cta||'Get Instant Access Now'}</a></div>
  </div>
</div>`:''}

${faq(c.faq)}
</body></html>`;
  }

  // ── BOOKING PAGE ─────────────────────────────────────────────────────────────
  if (mode === 'booking' || mode === 'apply') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Book Your Call'}</title><style>${CSS}</style></head><body>
${ticker()}
<div class="section section-dark" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge">✦ ${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:16px">${c.headline||'Book Your Free Strategy Call'}</h1>
    <p class="subline" style="margin:0 auto 32px">${c.subheadline||''}</p>
    ${c.bullets&&c.bullets.length?`<div style="max-width:480px;margin:0 auto 36px;text-align:left">${bullets(c.bullets)}</div>`:''}
  </div>
</div>
<div class="section section-mid">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:8px">${c.calendar_headline||'Pick a time that works for you'}</h2>
    <div class="divider"></div>
    <div style="background:#07070f;border:1px dashed rgba(78,204,163,.18);border-radius:14px;min-height:560px;display:flex;align-items:center;justify-content:center;padding:2rem;margin-top:8px">
      <p style="color:#4a4a6a;font-size:13px;line-height:2">📅 Paste your Calendly embed code here.<br>Replace this placeholder with your booking widget.</p>
    </div>
  </div>
</div>
${c.guarantee?`
<div class="section section-dark">
  <div class="container" style="text-align:center;max-width:520px">
    <div style="font-size:44px;margin-bottom:12px">🤝</div>
    <h2 class="headline headline-lg" style="margin-bottom:10px">${c.guarantee.headline||'No selling. Just a real conversation.'}</h2>
    <p style="font-size:15px;color:#8892b0">${c.guarantee.body||''}</p>
  </div>
</div>`:''}
${faq(c.faq)}
</body></html>`;
  }

  // ── BRIDGE PAGE ───────────────────────────────────────────────────────────────
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<title>${c.headline||'Special Offer'}</title><style>${CSS}</style></head><body>
${ticker()}
<div class="section section-dark" style="text-align:center;position:relative;overflow:hidden">
  <div class="hero-glow"></div>
  <div class="container" style="position:relative;z-index:1">
    ${c.badge?`<div class="badge">✦ ${c.badge}</div><br>`:''}
    <h1 class="headline headline-xl" style="margin-bottom:16px">${c.headline||'One Thing Before You Go'}</h1>
    <p class="subline" style="margin:0 auto 28px">${c.subheadline||''}</p>
    ${c.copy_body?`<p style="font-size:15px;color:#8892b0;max-width:560px;margin:0 auto 28px;line-height:1.8">${c.copy_body}</p>`:''}
    ${c.bullets&&c.bullets.length?`<div style="max-width:500px;margin:0 auto 36px;text-align:left">${bullets(c.bullets)}</div>`:''}
    <div class="cta-wrap">
      <a class="cta" href="${c.cta_url||'#'}" target="_blank" rel="noopener">${c.cta||'See What I Recommend'}</a>
      <p class="cta-note">${c.cta_note||''}</p>
    </div>
  </div>
</div>
${c.testimonials&&c.testimonials.length?`
<div class="section section-mid">
  <div class="container" style="text-align:center">
    <h2 class="headline headline-lg" style="margin-bottom:8px">Others are already seeing results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;text-align:left;margin-top:8px">${testimonials(c.testimonials)}</div>
  </div>
</div>`:''}
</body></html>`;
}
