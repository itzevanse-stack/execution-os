export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { type, productName, commission, monthlyTarget, niche, trafficMode, avatarData, productUrl } = req.body;
  const av = avatarData || {};

  // ─── AVATAR — Sonnet for deep reasoning ──────────────────────────────────
  if (type === 'avatar') {
    const prompt = `You are an elite market researcher.
Affiliate product: "${productName || 'high-ticket programme'}"
Niche: ${niche || 'Online Business'}
Commission: $${Number(commission || 1000).toLocaleString()} per sale
Monthly target: $${Number(monthlyTarget || (Number(commission)||1000) * 5).toLocaleString()}
Traffic: ${trafficMode || 'organic'}

Return ONLY valid JSON — no markdown:
{
  "name": "Avatar name (e.g. Ambitious Amanda)",
  "age": "32",
  "gender": "Primarily women",
  "location": "USA, UK, Australia",
  "job": "Their exact job title",
  "industry": "Their industry",
  "income": "$50k–$75k",
  "current": "2 sentences: their frustrating daily reality",
  "desired": "2 sentences: their dream outcome after results",
  "incomeGoal": "10000",
  "transformation": "The #1 transformation they want — one sentence",
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
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      const raw = (d.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s === -1) return res.status(500).json({ error: "Invalid format from AI." });
      return res.status(200).json(JSON.parse(raw.substring(s, e + 1)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── CALENDAR — Haiku for speed (5–10s, well under 60s limit) ────────────
  if (type === 'calendar') {
    const prompt = `You are an expert affiliate content copywriter.

PRODUCT: "${productName || 'affiliate product'}" | COMMISSION: $${Number(commission || 1000).toLocaleString()}
NICHE: ${niche || 'Online Business'} | TRAFFIC: ${trafficMode === 'paid' ? 'Paid Ads' : 'Organic'}
BUYER: ${av.job || 'professional'} struggling with "${av.pain || 'their main challenge'}"
Wants: "${av.transformation || 'their desired outcome'}"
Fears: "${av.fear || 'wasting money'}"

WEEK PLAN: Days 1–3 educate about the PROBLEM only (no product pitch). Days 4–5 introduce the product naturally. Days 6–7 drive action with clear CTAs.

Write content for ALL 7 DAYS. Each day = different topic and angle.

FORMAT (repeat exactly for each day):

DAY [N]: [Specific topic]

FACEBOOK POST (180–240 words):
[Post. Strong hook line 1. Short paragraphs. Perfect grammar. End with question.]

REEL 1 (30–40 sec):
HOOK: [3-second opener — bold or surprising]
SCRIPT: [Word-for-word. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

REEL 2 (30–40 sec):
HOOK: [Different style]
SCRIPT: [3 quick points. Natural.]
CAPTION: [2 lines + 5 hashtags]

EMAIL:
SUBJECT: [Under 45 chars]
PREVIEW: [Under 80 chars]
BODY: [180–220 words. One insight. One action step. Sign-off.]

RULES: Perfect grammar. Active voice. Sound human. Specific not vague. Never mention commission. Never say "game-changer" or "journey".`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }]
        })
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
