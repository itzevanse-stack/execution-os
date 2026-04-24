export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const {
    type,           // 'avatar' or 'calendar'
    productUrl,
    productName,
    commission,
    monthlyTarget,
    niche,
    trafficMode,    // 'organic' or 'paid'
    week,           // 1-4 (for calendar type)
    avatarData      // for calendar type — pass avatar from previous avatar call
  } = req.body;

  if (!productName && !productUrl) {
    return res.status(400).json({ error: "Missing product name or URL." });
  }
  if (!commission) {
    return res.status(400).json({ error: "Missing commission amount." });
  }

  // ── AVATAR GENERATION ────────────────────────────────────────────────────
  if (type === 'avatar') {
    const prompt = `You are an elite market researcher and buyer psychology expert.

An affiliate marketer is promoting this product:
- Product: "${productName}"
- Platform: ${productUrl ? (productUrl.includes('copecart') ? 'Copecart' : productUrl.includes('digistore24') ? 'Digistore24' : 'Affiliate Platform') : 'Affiliate Platform'}
- Niche: ${niche || 'Online Business'}
- Commission per sale: $${Number(commission).toLocaleString()}
- Monthly target: $${Number(monthlyTarget || commission * 5).toLocaleString()}
- Traffic strategy: ${trafficMode || 'organic'}

Generate a PRECISE buyer avatar — the exact person most likely to buy this product through social media content and DM outreach.

Return ONLY valid JSON:
{
  "name": "Avatar name (e.g. Ambitious Amanda)",
  "age": "32",
  "gender": "Primarily women",
  "location": "USA, UK, Australia",
  "job": "Marketing manager",
  "industry": "Corporate employment",
  "income": "$50k-$75k",
  "current": "2-3 sentences describing their frustrating current situation",
  "desired": "2-3 sentences describing their dream outcome after the product",
  "incomeGoal": "10000",
  "transformation": "The #1 transformation they desperately want in one sentence",
  "fear": "Their biggest fear about investing in a solution",
  "tried": "What they have already tried that did not work",
  "pain": "Core pain in 4-8 words",
  "motivation": "What drives them beyond money",
  "personality": "Their personality type",
  "influences": "3-5 influencers or communities they follow in this niche",
  "objections": "Top 2-3 objections before buying",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "productName": "${productName}",
  "productUrl": "${productUrl || ''}",
  "commission": ${Number(commission)},
  "niche": "${niche || 'Online Business'}",
  "contentAngles": ["Content angle 1 for promoting this product organically", "Content angle 2", "Content angle 3"],
  "dmStrategy": "2-3 sentences on the best DM approach for this specific product and audience"
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
          max_tokens: 2000,
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

  // ── CALENDAR WEEK GENERATION ─────────────────────────────────────────────
  if (type === 'calendar') {
    const weekNum  = parseInt(week) || 1;
    const startDay = (weekNum - 1) * 7 + 1;
    const av       = avatarData || {};
    const isPaid   = trafficMode === 'paid';

    const weekPhases = {
      1: "Week 1 — Build Trust & Credibility: post about the PROBLEM only. Never mention the product. Build authority.",
      2: "Week 2 — Education & Reveal: teach the solution approach. Introduce the product naturally mid-week.",
      3: "Week 3 — Proof & Social Evidence: share results, reviews, objection handling content.",
      4: "Week 4 — Urgency & Close: direct CTAs, scarcity, final push for conversions."
    };

    const prompt = `You are an expert affiliate content strategist and direct-response copywriter.

AFFILIATE CONTEXT:
- Product: "${productName}"
- Commission: $${Number(commission).toLocaleString()} per sale
- Target buyer: ${av.job || 'professionals'} dealing with "${av.pain || 'their main struggle'}"
- Their transformation: "${av.transformation || 'their desired outcome'}"
- Their fear: "${av.fear || 'fear of wasting money'}"
- What they've tried: "${av.tried || 'various solutions'}"
- Traffic: ${isPaid ? 'Paid ads — bridge page approach' : 'Organic — content + DM outreach'}

WEEK PHASE: ${weekPhases[weekNum] || weekPhases[1]}

Generate content for Days ${startDay}–${startDay + 6} (Week ${weekNum} of 4).

For EACH of the 7 days, create ALL 6 content pieces:

DAY [N]: [Topic — different every day, different angle and emotional trigger]

FACEBOOK POST 1 (280-350 words):
[Full post — personal story or educational value. Perfect grammar. Human voice.]

FACEBOOK POST 2 (220-280 words):
[Different angle — numbered list, framework, or case study. End with CTA.]

REEL SCRIPT 1 (45-60 seconds):
HOOK: [Pattern interrupt — first 3 seconds]
SCRIPT: [Full word-for-word, natural speech]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 2 (45-60 seconds):
HOOK: [Different hook style]
SCRIPT: [Educational, 3 points]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 3 (30-45 seconds):
HOOK: [Emotional opener]
SCRIPT: [Raw and authentic]
CAPTION: [1-2 lines + 5 hashtags]

EMAIL:
SUBJECT LINE: [Under 50 chars]
PREVIEW TEXT: [Under 90 chars]
BODY: [280-350 words, conversational, one insight, one action]

AFFILIATE RULES:
- Weeks 1-2: educate about the PROBLEM, never pitch the product
- Week 3+: introduce the product naturally, share others' results  
- Week 4: direct recommendation with your affiliate link
- Never mention commission or that it's an affiliate product in the content
- Sound like you genuinely found and love this product`;

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
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      const text = data.content?.[0]?.text || "";
      return res.status(200).json({ text, week: weekNum, startDay });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid type. Use 'avatar' or 'calendar'." });
}
