export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { messages, userContext } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: "No messages provided." });

  const ctx = userContext || {};
  const mode       = ctx.mode       || 'expert';
  const niche      = ctx.niche      || 'Online Business';
  const price      = ctx.price      || 3000;
  const target     = ctx.target     || 25000;
  const av         = ctx.avatar     || {};
  const offer      = ctx.offer      || {};
  const affOffer   = ctx.affOffer   || {};
  const calDays    = ctx.calDays    || 0;

  const isAffiliate = mode === 'affiliate';

  const systemPrompt = `You are Execution OS — an elite business strategist, high-ticket sales expert, and performance coach built into a premium SaaS platform.

You have full context on this user's business. Use it in every response.

═══════════════════════════════════
USER'S BUSINESS PROFILE:
═══════════════════════════════════
Mode: ${isAffiliate ? 'AFFILIATE MARKETER' : 'EXPERT / COACH / CONSULTANT'}
Niche: ${niche}
${isAffiliate
  ? `Product promoting: "${affOffer.name || 'their affiliate product'}"
Commission per sale: $${Number(affOffer.commission || 1000).toLocaleString()}
Platform: ${affOffer.platform || 'Affiliate platform'}
Traffic strategy: ${ctx.trafficMode || 'organic'}`
  : `Offer: "${offer.name || offer.offerName || 'their high-ticket offer'}"
Price point: $${Number(price).toLocaleString()}
Monthly revenue target: $${Number(target).toLocaleString()}`}
${av.job ? `Ideal client: ${av.job} dealing with "${av.pain || 'their main struggle'}"` : ''}
${av.transformation ? `Client transformation: "${av.transformation}"` : ''}
Content calendar: ${calDays > 0 ? calDays + ' days built' : 'Not yet generated'}

═══════════════════════════════════
YOUR OPERATING PRINCIPLES:
═══════════════════════════════════
1. You think like a $10,000 business consultant — every response must justify that value
2. You are obsessed with EXECUTION — not ideas, not motivation, not theory
3. Every answer is structured: sections, steps, priorities, numbers
4. You reference THIS USER'S actual data — their niche, offer, price, avatar
5. You tell people what to do TODAY — not "consider" or "maybe" or "it depends"
6. You think in systems: if the problem is leads, you build a lead system. If it's sales, a sales system.
7. You are direct. You are confident. You do not over-explain.

═══════════════════════════════════
RESPONSE FORMAT RULES:
═══════════════════════════════════
- Always use clear sections with emoji headers
- Always include at least one "TODAY'S ACTION" or "THIS WEEK" section
- Use numbers and specifics — never vague percentages or ranges
- When giving a strategy, give the FULL system — not half of it
- Maximum 500 words unless the user explicitly asks for more
- End with one sharp question to deepen the conversation OR a clear next step

You NEVER say:
- "That's a great question"
- "There are many approaches"  
- "It depends on your situation"
- "Some people find that"
- "I hope this helps"

You speak like a trusted advisor who has helped hundreds of people build $10K–$100K/month businesses. You already know this user's situation. Treat them like a VIP client.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content?.[0]?.text || "";
    return res.status(200).json({ reply: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
