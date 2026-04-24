export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const {
    niche, price, target, avatar,
    offer_dream, offer_result, offer_no_effort, offer_transformation,
    offer_system, offer_format, offer_duration, offer_difference,
    offer_stack, offer_guarantee, offer_guarantee_cond,
    offer_scarcity, offer_bonus, offer_name, offer_payment
  } = req.body;

  if (!niche || !price) {
    return res.status(400).json({ error: "Missing required fields: niche, price." });
  }

  const prompt = `You are Alex Hormozi's offer creation expert combined with the world's best direct-response copywriter.

Create a COMPLETE, compelling high-ticket offer for a ${niche} coach/consultant charging $${Number(price).toLocaleString()}.

OFFER INPUTS:
- Dream outcome: ${offer_dream || 'Not specified'}
- #1 measurable result: ${offer_result || 'Not specified'}
- What they don't have to do: ${offer_no_effort || 'Not specified'}
- Before/after transformation: ${offer_transformation || 'Not specified'}
- Unique delivery system: ${offer_system || 'Not specified'}
- Format: ${offer_format || 'Not specified'}
- Duration: ${offer_duration || 'Not specified'}
- What makes it different: ${offer_difference || 'Not specified'}
- Value stack: ${offer_stack || 'Not specified'}
- Guarantee: ${offer_guarantee || 'Not specified'}
- Guarantee condition: ${offer_guarantee_cond || 'Not specified'}
- Scarcity element: ${offer_scarcity || 'Not specified'}
- Fast-action bonus: ${offer_bonus || 'Not specified'}
- Offer name: ${offer_name || 'Not specified'}
- Payment structure: ${offer_payment || 'Not specified'}

TARGET BUYER: ${avatar ? `${avatar.job || 'professional'} dealing with "${avatar.pain || 'their main struggle'}" wanting "${avatar.transformation || 'their desired outcome'}"` : `${niche} target audience`}

Generate the complete offer document. Return ONLY valid JSON:

{
  "offerName": "The exact offer name (make it sound like a premium programme)",
  "headline": "The main headline — outcome-focused, specific, compelling (under 12 words)",
  "subheadline": "Supporting statement that adds specificity and credibility (under 20 words)",
  "hook": "Opening hook paragraph (3-4 sentences) — call out their exact pain, agitate it, then hint at the solution",
  "promise": "The bold promise in one sentence — specific outcome, specific timeframe",
  "uniqueMechanism": "Name and explain their unique system/method in 2-3 sentences",
  "valueStack": [
    {"item": "Component name", "description": "What it includes and how it helps", "value": 0},
    {"item": "Component name", "description": "What it includes and how it helps", "value": 0}
  ],
  "totalValue": 0,
  "price": ${Number(price)},
  "priceJustification": "2-3 sentences explaining why $${Number(price).toLocaleString()} is actually a bargain given the value and outcome",
  "guarantee": "The full guarantee statement — bold and specific",
  "scarcity": "The scarcity/urgency element",
  "cta": "The exact call-to-action text for the button or closing",
  "objectionHandlers": [
    {"objection": "I can't afford it", "response": "Powerful reframe specific to this offer"},
    {"objection": "I need to think about it", "response": "Powerful response"},
    {"objection": "I've tried things before and failed", "response": "Powerful response addressing their past attempts"}
  ],
  "funnelStrategy": {
    "primary": "The main funnel approach recommended for this offer and niche",
    "leadMagnet": "The ideal free lead magnet to attract this buyer",
    "tripwire": "Optional low-ticket entry point if relevant",
    "upsell": "What to offer after they buy"
  },
  "salesScript": {
    "opening": "How to open the sales conversation",
    "discovery": "The 3 key discovery questions to ask",
    "presentation": "How to present the offer once you understand their situation",
    "closing": "The exact closing line to use"
  }
}`;

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
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const rawText = data.content?.[0]?.text || "";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end   = clean.lastIndexOf("}");

    if (start === -1 || end === -1) return res.status(500).json({ error: "Invalid response format." });

    const result = JSON.parse(clean.substring(start, end + 1));
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
