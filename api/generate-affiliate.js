export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { type, productUrl, productName, commission, monthlyTarget, niche, trafficMode, avatarData } = req.body;
  const av = avatarData || {};

  // ── AVATAR ─────────────────────────────────────────────────────────────
  if (type === 'avatar') {
    const prompt = `You are an elite market researcher.
Affiliate product: "${productName || 'high-ticket programme'}"
Niche: ${niche || 'Online Business'}
Commission: $${Number(commission || 1000).toLocaleString()} per sale
Monthly target: $${Number(monthlyTarget || (commission||1000) * 5).toLocaleString()}
Traffic: ${trafficMode || 'organic'}

Return ONLY valid JSON — no markdown, no explanation:
{
  "name": "Avatar first name + descriptor (e.g. Ambitious Amanda)",
  "age": "32",
  "gender": "Primarily women",
  "location": "USA, UK, Australia",
  "job": "Their exact job title",
  "industry": "Their industry",
  "income": "$50k–$75k",
  "current": "2 sentences describing their frustrating daily reality",
  "desired": "2 sentences describing their dream outcome after results",
  "incomeGoal": "10000",
  "transformation": "The #1 transformation they want — one punchy sentence",
  "fear": "Their biggest fear about investing in a solution",
  "tried": "Specific things they have already tried that failed",
  "pain": "Core pain in 5–7 words",
  "motivation": "What drives them beyond money",
  "personality": "3-word personality description",
  "influences": "3 real influencers or communities they follow",
  "objections": "Top 2 objections before buying",
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "productName": "${productName || ''}",
  "commission": ${Number(commission || 1000)},
  "niche": "${niche || 'Online Business'}",
  "contentAngles": ["Angle 1 for promoting this product","Angle 2","Angle 3"],
  "dmStrategy": "2 sentences on the best DM approach for this product and audience"
}`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: prompt }] })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      const raw = d.content?.[0]?.text || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
      if (s === -1 || e === -1) return res.status(500).json({ error: "Invalid format." });
      return res.status(200).json(JSON.parse(clean.substring(s, e + 1)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── CALENDAR — 7 days, 4 pieces each, ONE call ─────────────────────────
  if (type === 'calendar') {
    const prompt = `You are an expert affiliate content copywriter.

PRODUCT: "${productName || 'affiliate product'}"
COMMISSION: $${Number(commission || 1000).toLocaleString()} per sale
NICHE: ${niche || 'Online Business'}
TRAFFIC: ${trafficMode === 'paid' ? 'Paid Ads' : 'Organic Content + DMs'}

BUYER AVATAR:
- Role: ${av.job || 'professional'}
- Core pain: "${av.pain || 'their main struggle'}"
- Fear: "${av.fear || 'fear of wasting money'}"
- Already tried: "${av.tried || 'various solutions'}"
- Transformation: "${av.transformation || 'their desired outcome'}"

WEEK STRATEGY: Start by educating about the PROBLEM (Days 1–3). Introduce the product naturally (Days 4–5). Drive action (Days 6–7). Never mention commission. Sound like you genuinely found and love this product.

Generate content for ALL 7 DAYS. Each day must have a different topic and angle.

Use this EXACT format for each day:

DAY [N]: [Specific topic]

FACEBOOK POST (220–280 words):
[Full post. First line stops the scroll. Short paragraphs. Perfect grammar. End with a question that gets comments.]

REEL 1 (35–45 seconds):
HOOK: [First 3 seconds — bold statement or pattern interrupt]
SCRIPT: [Full word-for-word. Natural conversational speech. No filler words.]
CAPTION: [2 lines + 5 hashtags]

REEL 2 (35–45 seconds):
HOOK: [Different hook style from Reel 1]
SCRIPT: [Teach 3 quick points. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

EMAIL (200–250 words):
SUBJECT: [Under 45 characters]
PREVIEW: [Under 80 characters]
BODY: [One clear insight. One action step. Warm sign-off with name.]

QUALITY RULES — NON-NEGOTIABLE:
- Perfect grammar in every single piece
- Active voice throughout — never passive
- Sound like a real human, not AI
- Specific and concrete — use real numbers, scenarios, names
- Never use: "game-changer", "journey", "in today's world", "let's be honest"
- Write specifically for ${av.job || 'the target audience'}`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      return res.status(200).json({ text: d.content?.[0]?.text || "" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid type. Use 'avatar' or 'calendar'." });
}
