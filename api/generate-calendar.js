export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const {
    week,           // 1-4
    niche,
    price,
    target,
    avatar,         // avatar object from generate-avatar
    offer,          // offer name/description
    mode            // 'expert' or 'affiliate'
  } = req.body;

  if (!week || !niche) {
    return res.status(400).json({ error: "Missing required fields: week, niche." });
  }

  const weekNum    = parseInt(week);
  const startDay   = (weekNum - 1) * 7 + 1;
  const isAffiliate = mode === 'affiliate';

  const weekPhases = {
    1: "Week 1 — Trust & Credibility: educate about the PROBLEM only. Never mention the offer directly. Build authority and relatability.",
    2: "Week 2 — Education & Value: deep-dive the solution approach. Introduce the offer naturally and softly.",
    3: "Week 3 — Proof & Social Evidence: share results, testimonials, reviews. Handle objections in content.",
    4: "Week 4 — Urgency & Close: drive direct action. Clear CTAs. Scarcity and outcome focus."
  };

  const avatarContext = avatar ? `
TARGET BUYER AVATAR:
- Name: ${avatar.name || 'Ideal Client'}
- Job: ${avatar.job || 'Professional'}
- Core pain: ${avatar.pain || 'their main struggle'}
- Fear: ${avatar.fear || 'fear of change'}
- Transformation: ${avatar.transformation || 'desired outcome'}
- Already tried: ${avatar.tried || 'various solutions'}
- Motivation: ${avatar.motivation || 'freedom and success'}
` : `Target audience: people in ${niche} struggling to grow their income.`;

  const prompt = `You are an expert social media content strategist and direct-response copywriter specialising in ${niche}.

${isAffiliate
  ? `CONTEXT: This person is an AFFILIATE MARKETER promoting: "${offer || 'a high-ticket programme'}"`
  : `CONTEXT: This person is a coach/consultant selling their own offer: "${offer || 'a high-ticket programme'}" at $${Number(price || 0).toLocaleString()}`
}

${avatarContext}

WEEK PHASE: ${weekPhases[weekNum] || weekPhases[1]}

Generate content for Days ${startDay}–${startDay + 6} (Week ${weekNum} of 4).

For EACH of the 7 days, create ALL 6 content pieces. Make every day genuinely different — different angle, different hook style, different emotional trigger.

DAY [N]:

FACEBOOK POST 1 (280-350 words):
[Full post — personal story or value. Perfect grammar. Human voice. No AI clichés. End with engagement question.]

FACEBOOK POST 2 (220-280 words):
[Educational angle. Include a numbered list or framework. End with save/share CTA.]

REEL SCRIPT 1 (talking head, 45-60 seconds):
HOOK: [First 3 seconds — pattern interrupt, bold statement, or provocative question]
SCRIPT: [Full word-for-word script, natural speech, conversational]
CAPTION: [2 lines + 5 relevant hashtags]

REEL SCRIPT 2 (educational breakdown, 45-60 seconds):
HOOK: [Different hook style from Reel 1]
SCRIPT: [Teach 3 points, natural speech]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 3 (personal/raw, 30-45 seconds):
HOOK: [Emotional opener]
SCRIPT: [Raw, authentic, personal]
CAPTION: [1-2 lines + 5 hashtags]

EMAIL:
SUBJECT LINE: [Under 50 characters, curiosity-driven]
PREVIEW TEXT: [Under 90 characters]
BODY: [280-350 words — conversational, one insight, one action step, personal sign-off]

RULES:
- Perfect grammar throughout
- Never use passive voice
- Sound like a real human expert, not AI
- Specific and concrete beats vague and general
- Week ${weekNum} phase governs the CTA intensity — ${weekNum <= 2 ? 'educate first, soft CTA only' : 'direct CTA is appropriate'}
- All content speaks directly to: ${avatar?.pain || 'their core struggle'}

Generate all 7 days now.`;

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
