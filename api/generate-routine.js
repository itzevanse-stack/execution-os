export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not set in Vercel environment variables." });
  }

  const {
    wake, sleep, job, biztime, weakness, addiction,
    belief, exercise, extype, lifegoal, identity,
    areas, target, niche
  } = req.body;

  // ── Validate all required fields ──────────────────────────────────────────
  const missing = [];
  if (!wake)                          missing.push("Wake up time");
  if (!sleep)                         missing.push("Bedtime");
  if (!job)                           missing.push("Job / work situation");
  if (!biztime)                       missing.push("Business hours available");
  if (!weakness)                      missing.push("Biggest personal weakness");
  if (!belief  || belief.trim()  === "") missing.push("Limiting belief");
  if (!exercise)                      missing.push("Exercise level");
  if (!extype)                        missing.push("Exercise style");
  if (!lifegoal || lifegoal.trim() === "") missing.push("Life goal");
  if (!identity || identity.trim() === "") missing.push("Identity goal");
  if (!areas   || areas.trim()   === "") missing.push("Areas to develop");

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Please complete all fields before generating. Missing: ${missing.join(", ")}.`
    });
  }

  const prompt = `You are the world's most elite life transformation coach — a blend of David Goggins' discipline, Tony Robbins' psychology, a seasoned pastor's spiritual wisdom, and a top business mentor's income strategy.

Your job is to build a DEEPLY PERSONALIZED daily routine for this exact person. Not a generic template. A life-changing, precision-engineered daily structure that:
- Breaks their specific addiction: "${addiction}"
- Destroys their limiting belief: "${belief}"
- Fixes their specific weakness: "${weakness}"
- Builds their faith, mind, body, soul, and spirit in balance
- Grows their business income toward $${Number(target).toLocaleString()}/month in ${niche}
- Fits EXACTLY within their real schedule: ${wake} to ${sleep}
- Works around their actual life: ${job}, with ${biztime} for business

THIS PERSON:
- Wakes at ${wake}, sleeps at ${sleep}
- Works: ${job}
- Has ${biztime} per day for their business
- Wants to develop: ${areas}
- Biggest weakness: ${weakness}
- Addiction/habit to break: ${addiction}
- Limiting belief holding them back: "${belief}"
- Exercise habit: ${exercise} — prefers: ${extype}
- #1 life goal beyond money: ${lifegoal}
- The person they want to become: "${identity}"
- Income target: $${Number(target).toLocaleString()}/month in ${niche}

ROUTINE DESIGN RULES:
1. Every block must directly address THIS person's specific situation — no generic advice
2. The addiction "${addiction}" must have specific replacement blocks — replace that time and urge with something powerful
3. The limiting belief "${belief}" must be attacked daily through a specific affirmation block — write the EXACT affirmation they should say out loud
4. Faith/spiritual blocks must be meaningful and deep — not just "pray for 5 minutes"
5. Body blocks must match their actual exercise level and preference: ${exercise} / ${extype}
6. Business blocks must be specific to ${niche} — not generic "work on business"
7. Include an evening wind-down that sets them up for tomorrow
8. The schedule MUST be realistic for someone who ${job}
9. Balance all these areas across the day: ${areas}
10. Make every "why" field deeply personal — speak directly to THEIR situation, pain, and goal

TONE FOR THE "WHY" FIELD:
- Speak directly to them like a coach who knows their story
- Reference their specific weakness, addiction, belief, or goal
- Be honest, direct, compassionate, and motivating
- 3-4 sentences minimum — make it count

Return ONLY a valid JSON array. No markdown. No explanation. Just the raw JSON array.

Each element is EITHER:

1. A section header:
{"section":"🌅  Section Name  ·  Time Range"}

2. A routine block:
{"time":"6:00 AM","dur":"20 min","icon":"🙏","title":"Specific block title","why":"3-4 sentences speaking directly to this person about WHY this specific block matters for THEIR life, addiction, belief, and goals.","tag":"Category","tagColor":"rgba(108,99,255,.12)","tagText":"var(--purple)","accent":"var(--purple)"}

Tag color options:
- Health/body/exercise: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Spiritual/faith/prayer: tagColor "rgba(108,99,255,.12)", tagText "var(--purple)", accent "var(--purple)"
- Revenue/sales/income: tagColor "rgba(255,217,61,.12)", tagText "var(--yellow)", accent "var(--yellow)"
- Content creation/posting: tagColor "rgba(225,48,108,.12)", tagText "#f472b6", accent "#e1306c"
- Mindset/journaling/affirmation: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"
- Business strategy/admin: tagColor "rgba(255,140,66,.15)", tagText "#ff8c42", accent "var(--orange)"
- Recovery/rest/wind-down: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Breaking addiction: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"

REQUIRED BLOCKS (must include all, customized for this person):
✅ Wake up ritual specific to ${wake}
✅ Deep spiritual/faith block — not generic
✅ Affirmation block that directly attacks: "${belief}" — write the exact words they say
✅ Exercise block matching: ${extype}
✅ Addiction-breaking replacement block for: "${addiction}"
✅ At least 2 business/income blocks specific to ${niche}
✅ Content creation or outreach block
✅ Mindset/personal development block
✅ Family/relationships/soul block
✅ Evening review and next-day planning block
✅ Wind-down and sleep preparation block

Include 4-6 section headers and 14-20 routine blocks. Make every single block count. This routine should feel like it was written by someone who truly knows this person.

ONLY return the JSON array — no markdown fences, no commentary, no explanation.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 6000,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: "You are an elite life transformation coach. You build deeply personalized daily routines. You ONLY respond with valid raw JSON arrays — no markdown, no explanation, no preamble. Start your response directly with [ and end with ]."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const parsed = await response.json();

    if (parsed.error) {
      return res.status(500).json({ error: parsed.error.message });
    }

    const rawText = parsed.choices?.[0]?.message?.content || "";
    const clean = rawText.replace(/```json|```/g, "").trim();

    // Extract JSON array even if there is any surrounding text
    const arrayStart = clean.indexOf("[");
    const arrayEnd = clean.lastIndexOf("]");

    if (arrayStart === -1 || arrayEnd === -1) {
      return res.status(500).json({ error: "AI returned invalid format." });
    }

    const jsonStr = clean.substring(arrayStart, arrayEnd + 1);
    const blocks = JSON.parse(jsonStr);

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(500).json({ error: "AI returned empty routine." });
    }

    return res.status(200).json({ blocks });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
