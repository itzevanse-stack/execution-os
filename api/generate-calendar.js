export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { niche, price, target, avatar, offer, mode, _rawPrompt, _maxTokens } = req.body;

  // ── Raw passthrough for generic callClaude() calls ─────────────────────
  if (_rawPrompt) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: _maxTokens || 2000, messages: [{ role: "user", content: _rawPrompt }] })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      return res.status(200).json({ text: d.content?.[0]?.text || "" });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  if (!niche) return res.status(400).json({ error: "Missing niche." });

  const av = avatar || {};
  const isAffiliate = mode === 'affiliate';

  const prompt = `You are a world-class direct-response copywriter and social media strategist specialising in ${niche}.

${isAffiliate ? `CONTEXT: Affiliate promoting: "${offer || 'a high-ticket programme'}"` : `CONTEXT: Coach/consultant with own offer: "${offer || 'a high-ticket programme'}" at $${Number(price||0).toLocaleString()}`}

BUYER AVATAR:
- Name: ${av.name || 'Ideal Client'} | Job: ${av.job || 'professional'}
- Core pain: "${av.pain || 'their main struggle'}"
- Fear: "${av.fear || 'fear of change'}"
- Already tried: "${av.tried || 'various solutions'}"
- Transformation: "${av.transformation || 'their desired outcome'}"
- Motivation: "${av.motivation || 'freedom and success'}"

WEEK STRATEGY:
- Days 1–2: Educate about the PROBLEM only. Zero selling. Pure value and relatability.
- Days 3–4: Teach the solution approach. Introduce the offer naturally.
- Days 5–6: Share proof, handle objections, build trust.
- Day 7: Clear, confident CTA. Outcome-focused.

Generate content for ALL 7 DAYS. Each day must have a DIFFERENT topic, angle, and emotional trigger.

Use this EXACT format:

DAY [N]: [Specific concrete topic]

FACEBOOK POST (220–280 words):
[Full post. First line stops scroll. Short paragraphs. Perfect grammar. Personal and specific. End with a question.]

REEL 1 (35–45 seconds):
HOOK: [First 3 seconds — pattern interrupt, bold claim, or vulnerable truth]
SCRIPT: [Full word-for-word. Natural speech. Short punchy sentences.]
CAPTION: [2 lines + 5 niche hashtags]

REEL 2 (35–45 seconds):
HOOK: [Different style from Reel 1]
SCRIPT: [Teach 3 specific points. Natural conversational tone.]
CAPTION: [2 lines + 5 hashtags]

EMAIL (200–250 words):
SUBJECT: [Under 45 characters — curiosity or self-interest]
PREVIEW: [Under 80 characters]
BODY: [One insight. One action step. Conversational. Warm sign-off.]

NON-NEGOTIABLE QUALITY RULES:
✓ Perfect grammar — every sentence
✓ Active voice always
✓ Sound human — never AI
✓ Specific over vague: use real numbers, timeframes, names
✓ Write for ${av.job || 'the exact target audience'} — not generic entrepreneurs
✓ Each day genuinely different in topic AND emotional approach
✓ Never use: "game-changer", "journey", "in today's world", "let's be honest"
${isAffiliate ? '✓ Never mention commission or that it is an affiliate product' : ''}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message });
    return res.status(200).json({ text: d.content?.[0]?.text || "" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
