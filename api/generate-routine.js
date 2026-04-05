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
    areas, target, niche,
    readtime, readhours, bedtimeritual
  } = req.body;

  // ── Validate all required fields ─────────────────────────────────────────
  const missing = [];
  if (!wake)                             missing.push("Wake up time");
  if (!sleep)                            missing.push("Bedtime");
  if (!job)                              missing.push("Job / work situation");
  if (!biztime)                          missing.push("Business hours available");
  if (!weakness)                         missing.push("Biggest personal weakness");
  if (!belief   || belief.trim()   === "") missing.push("Limiting belief");
  if (!exercise)                         missing.push("Exercise level");
  if (!extype)                           missing.push("Exercise style");
  if (!lifegoal || lifegoal.trim() === "") missing.push("Life goal");
  if (!identity || identity.trim() === "") missing.push("Identity goal");
  if (!areas    || areas.trim()    === "") missing.push("Areas to develop");
  if (!readtime)                         missing.push("Best time to read");
  if (!readhours)                        missing.push("Reading hours per day");
  if (!bedtimeritual)                    missing.push("Before-bed ritual");

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Please complete all fields before generating your routine. Missing: ${missing.join(", ")}.`
    });
  }

  const prompt = `You are the world's most elite life transformation coach — combining David Goggins' iron discipline, Tony Robbins' psychology, a deep pastor's spiritual wisdom, and a top business mentor's income strategy.

Your mission: Build a DEEPLY PERSONALIZED, life-transforming daily routine for this specific person. Not a template. A precision-engineered daily structure that will genuinely change their life — breaking their addictions, building their faith, developing their mind and body, strengthening their relationships, and growing their income.

═══════════════════════════════════
THIS PERSON'S FULL PROFILE:
═══════════════════════════════════
- Wake time: ${wake} | Bedtime: ${sleep}
- Job/situation: ${job}
- Business time available: ${biztime}/day
- Areas to develop: ${areas}
- Biggest weakness: ${weakness}
- Addiction/habit to break: "${addiction}"
- Limiting belief: "${belief}"
- Exercise level: ${exercise} | Preferred style: ${extype}
- Life goal beyond money: ${lifegoal}
- Who they want to become: "${identity}"
- Income target: $${Number(target).toLocaleString()}/month in ${niche}
- Best time to read/study: ${readtime}
- Reading/study hours per day: ${readhours}
- Before-bed ritual they want: ${bedtimeritual}

═══════════════════════════════════
DESIGN RULES — FOLLOW ALL OF THESE:
═══════════════════════════════════

1. READING & STUDY BLOCK:
   - Schedule their reading block at: ${readtime}
   - Duration: ${readhours} per day
   - Recommend books that match their goals in ${niche}, their life goal "${lifegoal}", and their mindset challenges
   - Split the reading into categories: 1 business/income book, 1 mindset/personal development book, and 1 faith/spiritual book
   - In the "why" field, name SPECIFIC book recommendations for them personally

2. BEFORE-BED RITUAL:
   - Their chosen before-bed ritual is: ${bedtimeritual}
   - Build a detailed, meaningful wind-down block around this — not generic
   - If they chose prayer: give them a specific prayer framework (thanksgiving, confession, intercession, petition)
   - If they chose Bible reading: recommend specific books of the Bible that match their current season
   - If they chose meditation: give a specific meditation method suited to their goals
   - If they chose journaling: give specific journal prompts that attack "${belief}" and reinforce "${identity}"
   - Make this block feel sacred and powerful — the last thing they do before sleep shapes tomorrow

3. ADDICTION BREAKING:
   - "${addiction}" must be directly replaced — identify the TIME and TRIGGER and replace it with a powerful alternative
   - Name the specific strategy: habit stacking, environment design, replacement behavior
   - Be direct and specific in the "why" — tell them exactly why this addiction is stealing their destiny

4. LIMITING BELIEF DESTRUCTION:
   - Write the EXACT affirmation they must say out loud every morning to destroy: "${belief}"
   - Make it personal, powerful, present-tense, and identity-based
   - Example format: "I am [identity]. I [capability]. I [result]."

5. FAITH & SPIRITUAL DEPTH:
   - Morning spiritual block must be deep and structured — not just "pray"
   - Include: gratitude, Scripture/devotional, prayer for direction, declaration over the day
   - Evening spiritual block ties into their chosen ritual: ${bedtimeritual}

6. BODY & HEALTH:
   - Exercise block matches exactly: ${exercise} level, ${extype} style
   - Include nutrition/hydration reminder if relevant to their energy and focus

7. BUSINESS & INCOME:
   - At least 2 dedicated blocks specifically for ${niche}
   - Be specific: content creation, DM outreach, sales calls, lead generation — whatever fits ${niche}
   - Connect income blocks to their target: $${Number(target).toLocaleString()}/month

8. MIND & PERSONAL DEVELOPMENT:
   - Reading block at ${readtime} for ${readhours} — include specific book recommendations
   - Journaling or reflection block
   - Skill development connected to ${niche}

9. SOUL & RELATIONSHIPS:
   - Family/relationship block — being fully present, phone down
   - Rest and recovery block — protecting their energy

10. SCHEDULE REALISM:
    - Every block MUST fit between ${wake} and ${sleep}
    - Account for their job: ${job}
    - The day must be demanding but achievable — not overwhelming

═══════════════════════════════════
"WHY" FIELD INSTRUCTIONS:
═══════════════════════════════════
- Write 3-5 sentences minimum
- Speak directly to THIS person — use "you" and reference their specific situation
- Reference their addiction, belief, weakness, or goal where relevant
- Be like a coach who knows their full story
- Make them feel: understood, challenged, and motivated
- For the reading block: name the EXACT books you recommend and why

═══════════════════════════════════
OUTPUT FORMAT:
═══════════════════════════════════
Return ONLY a valid JSON array. No markdown. No explanation. Start with [ and end with ].

Each element is EITHER a section header OR a routine block:

Section header:
{"section":"🌅  Section Name  ·  Time Range"}

Routine block:
{"time":"6:00 AM","dur":"20 min","icon":"📖","title":"Block Title","why":"Full personalized explanation with book recommendations where relevant, speaking directly to this person's situation.","tag":"Category","tagColor":"rgba(108,99,255,.12)","tagText":"var(--purple)","accent":"var(--purple)"}

Tag colors:
- Health/body: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Spiritual/faith: tagColor "rgba(108,99,255,.12)", tagText "var(--purple)", accent "var(--purple)"
- Revenue/income: tagColor "rgba(255,217,61,.12)", tagText "var(--yellow)", accent "var(--yellow)"
- Content/posting: tagColor "rgba(225,48,108,.12)", tagText "#f472b6", accent "#e1306c"
- Mindset/reading/affirmation: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"
- Business/strategy: tagColor "rgba(255,140,66,.15)", tagText "#ff8c42", accent "var(--orange)"
- Recovery/rest: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Breaking addiction: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"
- Reading/study: tagColor "rgba(255,217,61,.12)", tagText "var(--yellow)", accent "var(--yellow)"
- Before-bed ritual: tagColor "rgba(108,99,255,.12)", tagText "var(--purple)", accent "var(--purple)"

REQUIRED BLOCKS CHECKLIST (all must appear, deeply customized):
✅ Wake up ritual at ${wake}
✅ Morning spiritual/faith block (deep and structured)
✅ Identity affirmation that destroys: "${belief}" — write the exact words
✅ Exercise block: ${extype}
✅ Addiction replacement block for: "${addiction}"
✅ Reading/study block at ${readtime} for ${readhours} with specific book recommendations
✅ At least 2 business blocks specific to ${niche}
✅ Content creation or outreach block
✅ Mindset/journaling block
✅ Family/relationships/soul block
✅ Evening review and planning block
✅ Before-bed ritual block: ${bedtimeritual} — detailed and meaningful
✅ Sleep preparation block

Include 5-7 section headers and 16-22 routine blocks. Make this routine feel like it was written by someone who truly knows and cares about this person's transformation.

ONLY return the JSON array — nothing else.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 8000,
        temperature: 0.85,
        messages: [
          {
            role: "system",
            content: "You are an elite life transformation coach. You build deeply personalized daily routines that transform lives. You ONLY respond with valid raw JSON arrays — no markdown, no explanation, no preamble. Start your response directly with [ and end with ]."
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
