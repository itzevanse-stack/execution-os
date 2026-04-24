export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const {
    type, productUrl, productName, commission,
    monthlyTarget, niche, trafficMode,
    week, avatarData
  } = req.body;

  const av = avatarData || {};

  // ── AVATAR GENERATION (fast — ~8 seconds) ────────────────────────────────
  if (type === 'avatar') {
    const prompt = `You are an elite market researcher and buyer psychology expert.

An affiliate marketer is promoting: "${productName || 'a high-ticket programme'}"
- Platform URL: ${productUrl || 'not provided'}
- Niche: ${niche || 'Online Business'}
- Commission per sale: $${Number(commission || 1000).toLocaleString()}
- Monthly target: $${Number(monthlyTarget || commission * 5 || 5000).toLocaleString()}
- Traffic strategy: ${trafficMode || 'organic'}

Generate a precise buyer avatar — the exact person most likely to buy through social content and DMs.

Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "Avatar name (e.g. Ambitious Amanda)",
  "age": "32",
  "gender": "Primarily women",
  "location": "USA, UK, Australia",
  "job": "Marketing manager",
  "industry": "Corporate employment",
  "income": "$50k–$75k",
  "current": "2–3 sentences describing their frustrating current situation in vivid detail",
  "desired": "2–3 sentences describing their dream outcome after getting results",
  "incomeGoal": "10000",
  "transformation": "The #1 transformation they desperately want — one specific sentence",
  "fear": "Their biggest fear about investing in a solution like this",
  "tried": "What they have already tried that did not work — be specific",
  "pain": "Core pain in 5–8 words",
  "motivation": "What drives them beyond money",
  "personality": "3–4 word personality description",
  "influences": "3–5 influencers or communities they follow in this niche",
  "objections": "Top 2–3 objections before buying",
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "productName": "${productName || ''}",
  "commission": ${Number(commission || 1000)},
  "niche": "${niche || 'Online Business'}",
  "contentAngles": [
    "Specific content angle 1 for promoting this product organically",
    "Specific content angle 2",
    "Specific content angle 3"
  ],
  "dmStrategy": "2–3 sentences on the best DM approach for this specific product and audience"
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
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      const raw = data.content?.[0]?.text || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end   = clean.lastIndexOf("}");
      if (start === -1 || end === -1) return res.status(500).json({ error: "Invalid response format." });

      return res.status(200).json(JSON.parse(clean.substring(start, end + 1)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── CALENDAR WEEK GENERATION (3–4 days per call to stay under 60s) ──────
  if (type === 'calendar') {
    const weekNum  = parseInt(week) || 1;
    const startDay = (weekNum - 1) * 7 + 1;
    // Only generate 4 days per call to stay under timeout
    const daysPerCall = 4;
    const endDay = Math.min(startDay + daysPerCall - 1, (weekNum * 7));

    const weekPhases = {
      1: "WEEK 1 — Build Trust Only. Never mention the product. Educate about the PROBLEM. Make them feel completely understood.",
      2: "WEEK 2 — Education & Soft Reveal. Teach the solution. Introduce the product naturally mid-week. Keep CTAs gentle.",
      3: "WEEK 3 — Proof & Evidence. Share results, testimonials, objection-handling content.",
      4: "WEEK 4 — Urgency & Close. Direct confident CTAs. Every post drives action."
    };

    const prompt = `You are an expert affiliate content strategist and direct-response copywriter.

PRODUCT: "${productName || 'affiliate product'}"
COMMISSION: $${Number(commission || 1000).toLocaleString()} per sale
NICHE: ${niche || 'Online Business'}
TRAFFIC: ${trafficMode === 'paid' ? 'Paid Ads' : 'Organic'}

BUYER:
- Job: ${av.job || 'professional'}
- Core pain: "${av.pain || 'their main struggle'}"
- Fear: "${av.fear || 'fear of wasting money'}"
- Tried before: "${av.tried || 'various solutions'}"
- Transformation wanted: "${av.transformation || 'their desired outcome'}"

${weekPhases[weekNum] || weekPhases[1]}

Generate content for Days ${startDay}–${endDay} only (${endDay - startDay + 1} days).

For EACH day use this exact format:

DAY [N]: [SPECIFIC TOPIC]

FACEBOOK POST 1 (250–320 words):
[Full post. Hook line 1 stops the scroll. Short paragraphs. Perfect grammar. End with a question.]

FACEBOOK POST 2 (200–260 words):
[Educational angle. Numbered framework. End with save/share CTA. Perfect grammar.]

REEL SCRIPT 1 (40–55 seconds):
HOOK: [First 3 seconds — pattern interrupt]
SCRIPT: [Full word-for-word. Natural speech. No filler.]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 2 (40–55 seconds):
HOOK: [Different style]
SCRIPT: [Teach 3 points. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 3 (30–45 seconds):
HOOK: [Emotional opener]
SCRIPT: [Raw, authentic feel.]
CAPTION: [1–2 lines + 5 hashtags]

EMAIL:
SUBJECT: [Under 48 characters]
PREVIEW: [Under 88 characters]
BODY: [250–320 words. One insight. One action. Warm sign-off.]

RULES:
- Perfect grammar — no exceptions
- Active voice always
- Sound like a real human expert, never AI
- Specific over vague — use real numbers and scenarios
- Weeks 1–2: educate only, no product pitch
- Weeks 3–4: introduce product naturally, never mention commission
- Write specifically for ${av.job || 'the target audience'}`;

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
          max_tokens: 4500,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });

      const text = data.content?.[0]?.text || "";
      return res.status(200).json({ text, week: weekNum, startDay, endDay });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid type. Use 'avatar' or 'calendar'." });
}
