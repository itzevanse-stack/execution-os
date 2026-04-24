export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { week, niche, price, target, avatar, offer, mode, _rawPrompt, _maxTokens } = req.body;

  // ── Raw prompt passthrough (for generic callClaude calls) ──────────────
  if (_rawPrompt) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: _maxTokens || 2000, messages: [{ role: "user", content: _rawPrompt }] })
      });
      const data = await response.json();
      if (data.error) return res.status(500).json({ error: data.error.message });
      return res.status(200).json({ text: data.content?.[0]?.text || "" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Calendar week generation ───────────────────────────────────────────
  if (!week || !niche) return res.status(400).json({ error: "Missing week or niche." });

  const weekNum  = parseInt(week);
  const startDay = (weekNum - 1) * 7 + 1;
  const endDay   = Math.min(startDay + 1, 30); // 2 days per call stays well under 60s
  const isAffiliate = mode === 'affiliate';
  const av = avatar || {};

  const weekPhases = {
    1: "WEEK 1 — TRUST & AUTHORITY: Educate about the PROBLEM only. Zero selling. Build credibility and deep relatability. Make them feel completely understood.",
    2: "WEEK 2 — EDUCATION & SOFT REVEAL: Teach the solution framework. Introduce the offer naturally by Day 4. Keep CTAs soft — curiosity over pressure.",
    3: "WEEK 3 — PROOF & SOCIAL EVIDENCE: Testimonials, results, case studies, objection-busting content. Let outcomes speak. Handle every major objection through content.",
    4: "WEEK 4 — URGENCY & CLOSE: Direct, confident CTAs. Scarcity is real. Outcome-focused. Every post drives action. This is the conversion week."
  };

  const avatarContext = av.name ? `
BUYER AVATAR — write exclusively for this person:
- Name: ${av.name} | Age: ${av.age || '35'} | Job: ${av.job || 'professional'}
- Core pain: "${av.pain || av.transformation || 'their main struggle'}"
- Biggest fear: "${av.fear || 'wasting time and money'}"
- Already tried: "${av.tried || 'various solutions without success'}"
- Their transformation: "${av.transformation || 'their desired outcome'}"
- What motivates them: "${av.motivation || 'freedom and financial independence'}"
- Personality: ${av.personality || 'ambitious but frustrated'}
` : `Target audience: people in ${niche} wanting to grow their income.`;

  const prompt = `You are a world-class direct-response copywriter and social media strategist. You have generated millions in revenue through content that converts.

NICHE: ${niche}
OFFER: ${offer || 'High-ticket coaching programme'} ${price ? `at $${Number(price).toLocaleString()}` : ''}
MONTHLY TARGET: ${target ? `$${Number(target).toLocaleString()}` : 'not specified'}
MODE: ${isAffiliate ? 'Affiliate promotion' : 'Own high-ticket offer'}

${avatarContext}

${weekPhases[weekNum] || weekPhases[1]}

Generate content for Day ${startDay} and Day ${endDay} ONLY (2 days — keep responses concise).

Each day must have a DIFFERENT topic, angle, emotional trigger, and hook style. No repetition.

═══════════════════════════════════════
FOR EACH OF THE 7 DAYS:
═══════════════════════════════════════

DAY [N]: [SPECIFIC TOPIC — make it concrete, not generic]

FACEBOOK POST 1 (320-400 words):
Write a compelling personal-brand post. Rules:
• Hook line 1 must stop the scroll cold — bold claim, shocking stat, or vulnerable truth
• Short paragraphs (2-3 lines max)
• Personal story OR relatable situation specific to ${niche}
• Real, specific details — not vague generalisations
• Perfect grammar throughout
• End with a genuine question that invites comments
• Never use: "I want to talk about", "Let's be honest", "In today's world", "Game-changer", "Journey"

FACEBOOK POST 2 (270-340 words):
Educational value post from a different angle to Post 1. Rules:
• Open with a result or counterintuitive insight
• Use a numbered framework or step-by-step breakdown
• Each point must be specific and actionable
• End with save/share CTA
• Perfect grammar

REEL SCRIPT 1 — Talking Head (50-65 seconds):
HOOK (first 3 seconds, say AND show on screen): [Pattern interrupt — provocative, bold, or surprising]
SCRIPT: [Full word-for-word. Natural conversational speech. Short punchy sentences. No filler words.]
CAPTION: [2 compelling lines + 5 niche-specific hashtags]

REEL SCRIPT 2 — Educational Breakdown (50-65 seconds):
HOOK: [Different style from Script 1 — question, statistic, or bold statement]
SCRIPT: [Teach 3 specific points. Text overlays format. No filler. Every word earns its place.]
CAPTION: [2 lines + 5 hashtags]

REEL SCRIPT 3 — Raw & Personal (35-50 seconds):
HOOK: [Emotional, vulnerable, or raw opener]
SCRIPT: [Unscripted feel. First person. Authentic moment or realisation. Ends on a truth that resonates.]
CAPTION: [1-2 lines + 5 hashtags]

EMAIL — Nurture Sequence:
SUBJECT LINE: [Under 48 characters. Curiosity or self-interest. No clickbait.]
PREVIEW TEXT: [Under 88 characters. Extends the subject line naturally.]
BODY: [310-380 words. One insight. One action step. Conversational but expert. Warm sign-off with name.]

═══════════════════════════════════════
QUALITY STANDARDS — NON-NEGOTIABLE:
═══════════════════════════════════════
✓ Every sentence grammatically perfect — no exceptions
✓ Active voice throughout — never passive
✓ Specific beats vague: use real numbers, timeframes, names, scenarios
✓ Write for ${av.job || 'the target audience'} specifically — not generic entrepreneurs
✓ Each day's content genuinely different in topic AND emotional approach
✓ Sound like a trusted expert who has lived this — not an AI
✓ Week ${weekNum} intensity: ${weekNum <= 2 ? 'educate first, no hard selling' : weekNum === 3 ? 'lead with proof, soft CTA' : 'confident direct CTA every post'}
${isAffiliate ? '✓ Never mention commission or that this is affiliate content\n✓ Recommend from genuine personal experience angle' : ''}

Generate all 7 days now. Label each clearly.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2800, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text || "";
    return res.status(200).json({ text, week: weekNum, startDay });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
