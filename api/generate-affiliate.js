export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { type, productUrl, productName, commission, monthlyTarget, niche, trafficMode, week, avatarData } = req.body;
  const av = avatarData || {};

  // ── AVATAR (fast ~8s) ──────────────────────────────────────────────────
  if (type === 'avatar') {
    const prompt = `You are an elite market researcher.

Affiliate product: "${productName || 'high-ticket programme'}"
Niche: ${niche || 'Online Business'}
Commission: $${Number(commission || 1000).toLocaleString()} per sale
Monthly target: $${Number(monthlyTarget || commission * 5 || 5000).toLocaleString()}
Traffic: ${trafficMode || 'organic'}

Return ONLY valid JSON — no markdown:
{
  "name": "Avatar first name + descriptor (e.g. Ambitious Amanda)",
  "age": "32",
  "gender": "Primarily women",
  "location": "USA, UK, Australia",
  "job": "Their exact job title",
  "industry": "Their industry",
  "income": "$50k–$75k",
  "current": "2 sentences: their frustrating daily reality right now",
  "desired": "2 sentences: their dream life after getting results",
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
  "contentAngles": ["Content angle 1","Content angle 2","Content angle 3"],
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

  // ── CALENDAR — 2 days per call, stays well under 60s ──────────────────
  if (type === 'calendar') {
    const batchNum  = parseInt(week) || 1;          // 1–15
    const startDay  = (batchNum - 1) * 2 + 1;       // day 1,3,5…
    const endDay    = Math.min(startDay + 1, 30);    // 2 days per batch
    const apiWeek   = Math.ceil(batchNum / 4);       // map to week phase 1–4

    const phases = {
      1: "WEEK 1 — Trust only. Never mention the product. Educate about the PROBLEM.",
      2: "WEEK 2 — Education. Introduce the product naturally. Soft CTAs only.",
      3: "WEEK 3 — Proof. Share results, testimonials, handle objections.",
      4: "WEEK 4 — Close. Direct confident CTAs. Every post drives action."
    };

    const prompt = `You are an expert affiliate content copywriter.

PRODUCT: "${productName || 'affiliate product'}" | COMMISSION: $${Number(commission || 1000).toLocaleString()}
NICHE: ${niche || 'Online Business'} | TRAFFIC: ${trafficMode === 'paid' ? 'Paid Ads' : 'Organic'}
BUYER: ${av.job || 'professional'} dealing with "${av.pain || 'their struggle'}"
Transformation they want: "${av.transformation || 'their desired outcome'}"
Their fear: "${av.fear || 'wasting money'}" | Tried before: "${av.tried || 'various solutions'}"

${phases[apiWeek] || phases[1]}

Write content for Day ${startDay} and Day ${endDay} only.

FORMAT — repeat exactly for each day:

DAY [N]: [Specific topic — concrete, not generic]

FACEBOOK POST 1 (220–280 words):
[Full post. Hook stops scroll. Short paragraphs. Perfect grammar. End with question.]

FACEBOOK POST 2 (180–230 words):
[Educational. Numbered list or steps. Perfect grammar. End with CTA.]

REEL 1 (35–45 sec):
HOOK: [3-second pattern interrupt]
SCRIPT: [Full word-for-word. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

REEL 2 (35–45 sec):
HOOK: [Different style]
SCRIPT: [3 teaching points. Natural.]
CAPTION: [2 lines + 5 hashtags]

REEL 3 (25–35 sec):
HOOK: [Emotional opener]
SCRIPT: [Raw, authentic.]
CAPTION: [1–2 lines + 5 hashtags]

EMAIL:
SUBJECT: [Under 45 chars]
PREVIEW: [Under 80 chars]
BODY: [200–260 words. One insight. One action. Sign-off.]

RULES: Perfect grammar. Active voice. Human voice. Specific beats vague.
${apiWeek <= 2 ? 'Do NOT mention or pitch the product yet.' : 'You may reference the product naturally.'}`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2800, messages: [{ role: "user", content: prompt }] })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      return res.status(200).json({ text: d.content?.[0]?.text || "", batch: batchNum, startDay, endDay });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid type." });
}
