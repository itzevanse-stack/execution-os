// api/generate-funnel.js
// 2-step generation: AI writes copy as JSON → we inject into premium templates
// This guarantees beautiful, consistent, converting pages every time

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel.' });

  const { prompt, max_tokens, mode } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Step 1: Generate structured copy as JSON
  const COPY_SYSTEM = `You are the world's best direct-response copywriter. You write for affiliate marketers and expert coaches.

Your copy is specific, punchy, and conversion-focused. Never vague. Never corporate.

RULES:
- Headlines: MAX 8 words. Use a number or specific result.
  GOOD: "Make $3,000/Month Promoting Other People's Products"
  GOOD: "Get 3 High-Ticket Clients In 90 Days"
  BAD: "Discover the Amazing System That Will Transform Your Business"
- Subheadlines: 1 sentence. Name who it's for and what they get.
- Bullets: Start with the RESULT. "You will have..." not "Learn how to..."
- CTA: 3-5 words. Action + benefit. "Get Free Access Now" not "Submit"
- ZERO filler phrases. No dashes. No "game-changer". No "unlock potential".
- Write like you're texting a smart friend.

Return ONLY valid JSON. No markdown. No explanation.`;

  try {
    // Call Claude to get structured copy
    const copyResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(max_tokens || 3000, 3000),
        system: COPY_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!copyResp.ok) {
      const err = await copyResp.json().catch(() => ({}));
      return res.status(copyResp.status).json(err);
    }

    const copyData = await copyResp.json();
    let copyText = (copyData.content?.[0]?.text || '').trim();

    // Strip any accidental markdown fences
    copyText = copyText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let copy;
    try {
      copy = JSON.parse(copyText);
    } catch(e) {
      // If JSON parse fails, return raw text as HTML fallback
      return res.status(200).json({
        content: [{ type: 'text', text: copyText }],
        model: 'claude-sonnet-4-6',
      });
    }

    // Step 2: Render copy into premium HTML template
    const html = renderTemplate(copy, mode || 'optin');

    return res.status(200).json({
      content: [{ type: 'text', text: html }],
      model: 'claude-sonnet-4-6',
    });

  } catch(err) {
    console.error('generate-funnel error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── PREMIUM TEMPLATE RENDERER ─────────────────────────────────────────────────
function renderTemplate(c, mode) {
  const teal   = '#4ecca3';
  const gold   = '#f0c040';
  const purple = '#6c63ff';
  const dark   = '#06060f';

  const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">`;

  const baseCSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{background:${dark};color:#c8cde8;font-family:'Poppins',sans-serif;line-height:1.7;overflow-x:hidden}
    .wrap{max-width:720px;margin:0 auto;padding:0 24px}
    h1{font-size:clamp(30px,6vw,58px);font-weight:900;line-height:1.08;letter-spacing:-1.5px;color:#fff}
    h2{font-size:clamp(22px,4vw,36px);font-weight:800;color:#fff;line-height:1.2;letter-spacing:-.5px}
    h3{font-size:18px;font-weight:700;color:#fff}
    p{font-size:16px;color:#c8cde8;line-height:1.85}
    .grad{background:linear-gradient(135deg,${teal},${gold});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .grad-purple{background:linear-gradient(135deg,${purple},#a089ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .cta-btn{display:block;width:fit-content;margin:36px auto 0;background:linear-gradient(135deg,${teal},#2eb88a);color:${dark};font-weight:900;font-size:17px;font-family:'Poppins',sans-serif;padding:20px 52px;border-radius:8px;border:none;cursor:pointer;box-shadow:0 0 60px rgba(78,204,163,.3),0 8px 32px rgba(0,0,0,.5);letter-spacing:.3px;text-transform:uppercase;transition:all .2s;text-decoration:none}
    .cta-btn:hover{transform:translateY(-3px);box-shadow:0 0 90px rgba(78,204,163,.5),0 12px 40px rgba(0,0,0,.6)}
    .cta-note{display:block;text-align:center;margin-top:10px;font-size:12px;color:#7a7a9d}
    .card{background:#111128;border:1px solid rgba(78,204,163,.1);border-radius:16px;padding:28px}
    .section{padding:80px 0}
    .section-alt{background:#0b0b1a;padding:80px 0}
    .ticker{background:rgba(78,204,163,.06);border-bottom:1px solid rgba(78,204,163,.12);padding:10px 0;overflow:hidden;white-space:nowrap}
    .ticker-inner{display:inline-block;animation:ticker 30s linear infinite}
    .ticker-inner:hover{animation-play-state:paused}
    @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .stars{color:${gold};font-size:16px;letter-spacing:2px}
    .badge{display:inline-block;background:rgba(78,204,163,.1);border:1px solid rgba(78,204,163,.2);color:${teal};font-size:11px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:.5px;text-transform:uppercase}
    .glow{position:absolute;top:0;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse at center,rgba(78,204,163,.07) 0%,transparent 70%);pointer-events:none;z-index:0}
    .bullet-list{list-style:none;display:flex;flex-direction:column;gap:12px;text-align:left}
    .bullet-list li{display:flex;align-items:flex-start;gap:10px;font-size:15px;color:#c8cde8}
    .bullet-list li::before{content:'✓';color:${teal};font-weight:900;flex-shrink:0;margin-top:2px}
    .divider{width:60px;height:3px;background:linear-gradient(90deg,${teal},${gold});border-radius:2px;margin:16px auto 24px}
    @media(max-width:768px){.wrap{padding:0 16px}h1{font-size:clamp(26px,8vw,36px)}.section,.section-alt{padding:60px 0}.cta-btn{width:100%;text-align:center;padding:18px 24px}}
  `;

  const bullets = (arr) => arr && arr.length
    ? `<ul class="bullet-list">${arr.map(b => `<li>${b}</li>`).join('')}</ul>` : '';

  const testimonials = (arr) => arr && arr.length
    ? arr.map(t => `
      <div class="card" style="text-align:left;margin-bottom:16px">
        <div class="stars">★★★★★</div>
        <p style="margin:10px 0;font-style:italic;color:#d0d8f0">"${t.quote}"</p>
        <div style="font-size:12px;color:${teal};font-weight:700">${t.name}${t.title ? ' — ' + t.title : ''}</div>
      </div>`).join('') : '';

  const faqSection = (arr) => arr && arr.length ? `
    <div class="section">
      <div class="wrap" style="text-align:center">
        <div class="badge">Common Questions</div>
        <h2 style="margin:16px 0 8px">You probably have questions</h2>
        <div class="divider"></div>
        <div style="text-align:left;display:flex;flex-direction:column;gap:12px;margin-top:24px">
          ${arr.map(f => `
            <div class="card">
              <div style="font-weight:700;color:#fff;margin-bottom:6px">${f.q}</div>
              <p style="font-size:14px;color:#a0a8c0">${f.a}</p>
            </div>`).join('')}
        </div>
      </div>
    </div>` : '';

  const tickerItems = (c.ticker || [
    `${c.social_proof || '2,847 people joined this week'}`,
    `${c.result_stat || 'Average member sees results in 30 days'}`,
    `${c.trust_line  || '100% free to get started'}`,
  ]);
  const tickerHTML = `<div class="ticker"><div class="ticker-inner">&nbsp;&nbsp;&nbsp;${tickerItems.join('&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;')}&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;${tickerItems.join('&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;')}</div></div>`;

  // ── OPT-IN / LANDING PAGE ────────────────────────────────────────────────────
  if (mode === 'optin' || mode === 'landing' || mode === 'lead') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}<title>${c.headline || 'Free Training'}</title><style>${baseCSS}</style></head><body>
${tickerHTML}
<div class="section" style="position:relative;overflow:hidden;text-align:center;padding-top:100px;padding-bottom:80px">
  <div class="glow"></div>
  <div class="wrap" style="position:relative;z-index:1">
    ${c.badge ? `<div class="badge" style="margin-bottom:16px">${c.badge}</div>` : ''}
    <h1>${highlightKeyword(c.headline || 'Your Headline Here', teal)}</h1>
    ${c.subheadline ? `<p style="font-size:19px;color:#a0a8c0;margin:20px auto 0;max-width:560px">${c.subheadline}</p>` : ''}
    ${c.bullets ? `<div style="max-width:480px;margin:32px auto 0">${bullets(c.bullets)}</div>` : ''}

    <!-- Opt-in form -->
    <div class="card" style="max-width:440px;margin:40px auto 0;text-align:left">
      ${c.form_headline ? `<h3 style="text-align:center;margin-bottom:20px">${c.form_headline}</h3>` : ''}
      <div style="display:flex;flex-direction:column;gap:12px">
        <input id="ln" type="text" placeholder="First Name" style="background:#1a1a35;border:1px solid rgba(78,204,163,.2);border-radius:8px;padding:14px 16px;color:#fff;font-family:'Poppins',sans-serif;font-size:14px;outline:none">
        <input id="le" type="email" placeholder="Email Address" style="background:#1a1a35;border:1px solid rgba(78,204,163,.2);border-radius:8px;padding:14px 16px;color:#fff;font-family:'Poppins',sans-serif;font-size:14px;outline:none">
        <button onclick="if(window.captureEOSLead)window.captureEOSLead(document.getElementById('le').value,document.getElementById('ln').value);setTimeout(function(){window.location.href='?page=vsl';},400);" style="background:linear-gradient(135deg,${teal},#2eb88a);color:${dark};font-weight:900;font-size:16px;font-family:'Poppins',sans-serif;padding:16px;border-radius:8px;border:none;cursor:pointer;text-transform:uppercase;letter-spacing:.3px;box-shadow:0 0 40px rgba(78,204,163,.3)">${c.cta || 'Get Free Access Now'}</button>
        ${c.cta_note ? `<p style="text-align:center;font-size:11px;color:#7a7a9d;margin-top:4px">${c.cta_note}</p>` : ''}
      </div>
    </div>
  </div>
</div>

${c.testimonials && c.testimonials.length ? `
<div class="section-alt">
  <div class="wrap" style="text-align:center">
    <div class="badge" style="margin-bottom:16px">Real Results</div>
    <h2>Here's what others are saying</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:32px;text-align:left">${testimonials(c.testimonials)}</div>
  </div>
</div>` : ''}

${c.features ? `
<div class="section">
  <div class="wrap" style="text-align:center">
    <h2>${c.features_headline || 'What you get when you join'}</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:32px">
      ${(c.features||[]).map(f => `<div class="card" style="text-align:center"><div style="font-size:28px;margin-bottom:10px">${f.icon||'✓'}</div><h3 style="margin-bottom:8px;font-size:15px">${f.title}</h3><p style="font-size:13px;color:#7a7a9d">${f.desc}</p></div>`).join('')}
    </div>
  </div>
</div>` : ''}

${faqSection(c.faq)}

<div class="section" style="text-align:center">
  <div class="wrap">
    <h2>${c.final_cta_headline || 'Ready to get started?'}</h2>
    ${c.final_cta_sub ? `<p style="margin-top:12px">${c.final_cta_sub}</p>` : ''}
    <div class="card" style="max-width:440px;margin:32px auto 0;text-align:left">
      <div style="display:flex;flex-direction:column;gap:12px">
        <input id="ln2" type="text" placeholder="First Name" style="background:#1a1a35;border:1px solid rgba(78,204,163,.2);border-radius:8px;padding:14px 16px;color:#fff;font-family:'Poppins',sans-serif;font-size:14px;outline:none">
        <input id="le2" type="email" placeholder="Email Address" style="background:#1a1a35;border:1px solid rgba(78,204,163,.2);border-radius:8px;padding:14px 16px;color:#fff;font-family:'Poppins',sans-serif;font-size:14px;outline:none">
        <button onclick="if(window.captureEOSLead)window.captureEOSLead(document.getElementById('le2').value,document.getElementById('ln2').value);setTimeout(function(){window.location.href='?page=vsl';},400);" style="background:linear-gradient(135deg,${teal},#2eb88a);color:${dark};font-weight:900;font-size:16px;font-family:'Poppins',sans-serif;padding:16px;border-radius:8px;border:none;cursor:pointer;text-transform:uppercase;letter-spacing:.3px;box-shadow:0 0 40px rgba(78,204,163,.3)">${c.cta || 'Get Free Access Now'}</button>
        ${c.cta_note ? `<p style="text-align:center;font-size:11px;color:#7a7a9d;margin-top:4px">${c.cta_note}</p>` : ''}
      </div>
    </div>
  </div>
</div>
</body></html>`;
  }

  // ── VSL PAGE ──────────────────────────────────────────────────────────────────
  if (mode === 'vsl') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}<title>${c.headline || 'Free Training'}</title><style>${baseCSS}</style></head><body>
${tickerHTML}
<div class="section" style="text-align:center">
  <div class="wrap">
    ${c.badge ? `<div class="badge" style="margin-bottom:16px">${c.badge}</div>` : ''}
    <h1>${highlightKeyword(c.headline || 'Your Headline Here', teal)}</h1>
    ${c.subheadline ? `<p style="font-size:19px;color:#a0a8c0;margin:20px auto 0;max-width:560px">${c.subheadline}</p>` : ''}
    <!-- Video placeholder -->
    <div id="video-placeholder" style="max-width:720px;margin:40px auto;background:#0d0d20;border:1px solid rgba(78,204,163,.15);border-radius:16px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;cursor:pointer">
      <div style="text-align:center"><div style="font-size:56px;margin-bottom:12px">▶</div><p style="color:#7a7a9d;font-size:14px">Your training video goes here</p></div>
    </div>
    ${c.video_note ? `<p style="font-size:13px;color:#7a7a9d;margin-top:8px">${c.video_note}</p>` : ''}
  </div>
</div>

<div class="section-alt">
  <div class="wrap" style="text-align:center">
    ${c.copy_headline ? `<h2>${c.copy_headline}</h2><div class="divider"></div>` : ''}
    ${c.copy_body ? `<p style="max-width:640px;margin:0 auto">${c.copy_body}</p>` : ''}
    ${c.bullets ? `<div style="max-width:500px;margin:32px auto 0">${bullets(c.bullets)}</div>` : ''}
    <a class="cta-btn" href="${c.cta_url || '#'}" onclick="${c.cta_onclick || ''}">${c.cta || 'Get Instant Access Now'}</a>
    ${c.cta_note ? `<span class="cta-note">${c.cta_note}</span>` : ''}
  </div>
</div>

${c.testimonials && c.testimonials.length ? `
<div class="section">
  <div class="wrap" style="text-align:center">
    <div class="badge" style="margin-bottom:16px">Results</div>
    <h2>People are already getting results</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:32px;text-align:left">${testimonials(c.testimonials)}</div>
    <a class="cta-btn" href="${c.cta_url || '#'}" style="margin-top:48px">${c.cta || 'Get Instant Access Now'}</a>
    ${c.cta_note ? `<span class="cta-note">${c.cta_note}</span>` : ''}
  </div>
</div>` : ''}

${faqSection(c.faq)}
</body></html>`;
  }

  // ── BOOKING / APPLY PAGE ──────────────────────────────────────────────────────
  if (mode === 'booking' || mode === 'apply') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}<title>${c.headline || 'Book Your Call'}</title><style>${baseCSS}</style></head><body>
${tickerHTML}
<div class="section" style="text-align:center">
  <div class="wrap">
    ${c.badge ? `<div class="badge" style="margin-bottom:16px">${c.badge}</div>` : ''}
    <h1>${highlightKeyword(c.headline || 'Book Your Free Strategy Call', teal)}</h1>
    ${c.subheadline ? `<p style="font-size:18px;color:#a0a8c0;margin:20px auto 0;max-width:560px">${c.subheadline}</p>` : ''}
    ${c.bullets ? `<div style="max-width:480px;margin:28px auto">${bullets(c.bullets)}</div>` : ''}
  </div>
</div>

<div class="section-alt">
  <div class="wrap" style="text-align:center">
    <h2>${c.calendar_headline || 'Choose a time that works for you'}</h2>
    <div class="divider"></div>
    <div id="calendly-embed" style="background:rgba(255,255,255,.02);border:1px dashed rgba(78,204,163,.2);border-radius:16px;min-height:580px;display:flex;align-items:center;justify-content:center;margin-top:24px;padding:2rem;text-align:center">
      <p style="color:#7a7a9d;font-size:14px;line-height:2">📅 Paste your Calendly embed code here.<br>Replace this block with your booking widget.</p>
    </div>
  </div>
</div>

${c.testimonials && c.testimonials.length ? `
<div class="section">
  <div class="wrap" style="text-align:center">
    <h2>What happens on the call</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:32px;text-align:left">${testimonials(c.testimonials)}</div>
  </div>
</div>` : ''}

${c.guarantee ? `
<div class="section-alt">
  <div class="wrap" style="text-align:center">
    <div style="font-size:48px;margin-bottom:12px">🤝</div>
    <h2>${c.guarantee.headline || 'No selling. Just a real conversation.'}</h2>
    <p style="max-width:480px;margin:16px auto;color:#a0a8c0">${c.guarantee.body || 'This is a free strategy call. We talk about your goals and whether we can help. No pressure, no pitch.'}</p>
  </div>
</div>` : ''}
</body></html>`;
  }

  // ── BRIDGE PAGE ───────────────────────────────────────────────────────────────
  if (mode === 'bridge') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}<title>${c.headline || 'Special Offer'}</title><style>${baseCSS}</style></head><body>
${tickerHTML}
<div class="section" style="text-align:center">
  <div class="wrap">
    ${c.badge ? `<div class="badge" style="margin-bottom:16px">${c.badge}</div>` : ''}
    <h1>${highlightKeyword(c.headline || 'One Thing Before You Go', teal)}</h1>
    ${c.subheadline ? `<p style="font-size:18px;color:#a0a8c0;margin:16px auto 0;max-width:560px">${c.subheadline}</p>` : ''}
    ${c.copy_body ? `<p style="max-width:600px;margin:24px auto">${c.copy_body}</p>` : ''}
    ${c.bullets ? `<div style="max-width:480px;margin:28px auto">${bullets(c.bullets)}</div>` : ''}
    <a class="cta-btn" href="${c.cta_url || '#'}" target="_blank" rel="noopener">${c.cta || 'See What I Recommend'}</a>
    ${c.cta_note ? `<span class="cta-note">${c.cta_note}</span>` : ''}
  </div>
</div>
${c.testimonials && c.testimonials.length ? `
<div class="section-alt">
  <div class="wrap" style="text-align:center">
    <h2>Others who went through this are saying:</h2>
    <div class="divider"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:32px;text-align:left">${testimonials(c.testimonials)}</div>
  </div>
</div>` : ''}
</body></html>`;
  }

  // Default fallback
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}<title>${c.headline||'Page'}</title><style>${baseCSS}</style></head><body>
<div class="section" style="text-align:center"><div class="wrap"><h1>${c.headline||'Headline'}</h1>${c.subheadline?`<p style="margin-top:16px">${c.subheadline}</p>`:''}<a class="cta-btn" href="#">${c.cta||'Get Started'}</a></div></div>
</body></html>`;
}

function highlightKeyword(text, color) {
  // Bold the last 2-3 words or words with $ / numbers
  return text.replace(/(\$[\d,]+(?:\/\w+)?|\d+[\w\s]*(days?|months?|hours?|clients?|people)?)/gi,
    `<span style="color:${color}">$1</span>`);
}
