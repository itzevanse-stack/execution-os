// api/generate-funnel.js — Vercel serverless function
// Uses streaming + system prompt with reference example for pro-quality funnels
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel.' });

  const { prompt, max_tokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const SYSTEM = `You are an elite conversion copywriter and UI designer who builds stunning, high-converting sales funnels.

Your funnels are used by Alex Hormozi, Russell Brunson, and top ClickFunnels creators. They look professional, load fast, and convert cold traffic.

QUALITY STANDARD — Every page you build must meet these non-negotiable rules:

COPY RULES:
- H1 headline: MAX 8 WORDS. Specific result or number. Never vague.
  ✅ "Get 3 Clients In 90 Days — Guaranteed"
  ✅ "Make $5,000/Month From Your Phone"
  ❌ "Discover The Amazing System That Will Transform Your Business"
- Subheadline: 1 sentence only. Name the audience + specific outcome.
- Body text: Short punchy sentences. Max 2 lines per paragraph.
- Bullet points: Lead with the RESULT, not the action.
  ✅ "You will have a full client roster in 60 days"
  ❌ "Learn how to get more clients"
- CTA buttons: 3-5 words. Specific action + benefit.
  ✅ "Get Free Access Now" / "Book My Free Call"
  ❌ "Submit" / "Click Here" / "Learn More"
- ZERO hollow phrases: no "game-changer", "transform your life", "unlock potential", "journey"
- Write like a smart friend texting, not a corporate brochure

DESIGN RULES — The page must look STUNNING:
- Background: #06060f (near black)
- Max content width: 720px centered (NOT 1100px — narrow converts)
- Google Font import: Poppins 400,600,700,800,900
- H1: clamp(32px,6vw,60px) weight 900, line-height 1.08, letter-spacing -2px
- H1 key phrase: gradient text — background:linear-gradient(135deg,#4ecca3,#f0c040);-webkit-background-clip:text;-webkit-text-fill-color:transparent
- Subheadline: 18px, color:#a0a8c0, line-height 1.6, max-width 560px centered
- Body: 16px, color:#c8cde8, line-height 1.85
- Cards: background:#111128; border:1px solid rgba(78,204,163,0.1); border-radius:16px; padding:28px
- Accent teal: #4ecca3 — all CTAs, icons, highlights
- Gold: #f0c040 — results, numbers, stars
- Hero padding: 100px top, 60px bottom (48px mobile)
- Section spacing: 80px between sections

CTA BUTTON — Make it irresistible:
- display:block; width:fit-content; margin:36px auto 0
- background:linear-gradient(135deg,#4ecca3,#2eb88a)
- color:#06060f; font-weight:900; font-size:17px; font-family:Poppins
- padding:20px 52px; border-radius:8px; border:none; cursor:pointer
- box-shadow:0 0 60px rgba(78,204,163,0.3), 0 8px 32px rgba(0,0,0,0.5)
- text-transform:uppercase; letter-spacing:0.5px
- On hover: transform:translateY(-3px); box-shadow increases
- Small gray text BELOW button: 13px reassurance line

MANDATORY ELEMENTS on every page:
1. Ticker bar at top — scrolling social proof, 3 statements, separated by ◆
2. Radial glow behind headline: background:radial-gradient(ellipse at 50% 0%,rgba(78,204,163,0.07) 0%,transparent 70%)
3. Benefit cards in 2-3 column grid with left border accent: border-left:3px solid #4ecca3
4. Social proof bar: 3 short results with ★★★★★ in gold
5. Mobile responsive: @media(max-width:768px) single column, full-width CTAs, clamp font sizes

OUTPUT FORMAT:
- Return ONLY complete HTML from <!DOCTYPE html> to </html>
- All CSS in one <style> block in <head>
- Zero external CSS files, zero JS frameworks
- No markdown, no explanation, no code fences — raw HTML only`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: Math.min(max_tokens || 5000, 5000),
        system:     SYSTEM,
        messages:   [{ role: 'user', content: prompt }],
        stream:     true,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      return res.status(response.status).json(err);
    }

    // Stream — collect and return when complete
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text;
          }
        } catch(e) {}
      }
    }

    return res.status(200).json({
      content: [{ type: 'text', text: fullText }],
      model:   'claude-sonnet-4-6',
    });

  } catch(err) {
    console.error('generate-funnel error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
