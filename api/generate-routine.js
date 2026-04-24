export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Vercel environment variables." });

  const {
    wake, sleep, job, biztime, weakness, addiction,
    belief, exercise, extype, lifegoal, identity,
    areas, target, niche,
    readtime, readhours, bedtimeritual
  } = req.body;

  const missing = [];
  if (!wake)       missing.push("Wake up time");
  if (!sleep)      missing.push("Bedtime");
  if (!job)        missing.push("Job / work situation");
  if (!biztime)    missing.push("Business hours available");
  if (!weakness)   missing.push("Biggest personal weakness");
  if (!belief   || belief.trim()   === "") missing.push("Limiting belief");
  if (!exercise)   missing.push("Exercise level");
  if (!extype)     missing.push("Exercise style");
  if (!lifegoal || lifegoal.trim() === "") missing.push("Life goal");
  if (!identity || identity.trim() === "") missing.push("Identity goal");
  if (!areas    || areas.trim()    === "") missing.push("Areas to develop");
  if (!readtime)   missing.push("Best time to read");
  if (!readhours)  missing.push("Reading hours per day");
  if (!bedtimeritual) missing.push("Before-bed ritual");

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Please complete all fields before generating your routine. Missing: ${missing.join(", ")}.`
    });
  }

  const prompt = `You are the world's most elite life transformation coach — combining David Goggins' iron discipline, Tony Robbins' psychology, a deep pastor's spiritual wisdom, and a top business mentor's income strategy.

Your mission: Build a DEEPLY PERSONALIZED, life-transforming daily routine for this specific person. Not a template. A precision-engineered daily structure that will genuinely change their life.

THIS PERSON'S FULL PROFILE:
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
- Income target: $${Number(target || 0).toLocaleString()}/month in ${niche}
- Best time to read/study: ${readtime}
- Reading/study hours per day: ${readhours}
- Before-bed ritual they want: ${bedtimeritual}

DESIGN RULES:
1. Reading block at ${readtime} for ${readhours} — recommend SPECIFIC books matching their goals in ${niche}, "${lifegoal}", and mindset challenges
2. Before-bed ritual: "${bedtimeritual}" — make it sacred, detailed, and meaningful
3. Addiction replacement: "${addiction}" — name the exact time, trigger, and replacement behavior
4. Limiting belief destruction: write the EXACT affirmation to say every morning to destroy "${belief}"
5. Faith block: gratitude, Scripture/devotional, prayer, declaration — deep and structured
6. Exercise block: matches ${exercise} level and ${extype} style
7. At least 2 business blocks specific to ${niche} connecting to $${Number(target || 0).toLocaleString()}/month target
8. Every block fits between ${wake} and ${sleep}, accounting for: ${job}

WHY FIELD: 3-5 sentences minimum. Speak directly to THIS person. Reference their addiction, belief, weakness, or goal. Name specific books in the reading block.

Return ONLY a valid JSON array. No markdown. No explanation. Start with [ and end with ].

Section header format: {"section":"🌅  Section Name  ·  Time Range"}

Routine block format:
{"time":"6:00 AM","dur":"20 min","icon":"📖","title":"Block Title","why":"Full personalized explanation speaking directly to this person.","tag":"Category","tagColor":"rgba(108,99,255,.12)","tagText":"var(--purple)","accent":"var(--purple)"}

Tag colors:
- Health/body: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Spiritual/faith: tagColor "rgba(108,99,255,.12)", tagText "var(--purple)", accent "var(--purple)"
- Revenue/income: tagColor "rgba(255,217,61,.12)", tagText "var(--yellow)", accent "var(--yellow)"
- Content/posting: tagColor "rgba(225,48,108,.12)", tagText "#f472b6", accent "#e1306c"
- Mindset/reading: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"
- Business/strategy: tagColor "rgba(255,140,66,.15)", tagText "#ff8c42", accent "var(--orange)"
- Recovery/rest: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"

Include 5-7 section headers and 16-22 routine blocks. ONLY return the JSON array.`;

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
        messages: [{
          role: "user",
          content: prompt
        }]
      })
    });

    const data = await response.json();

    if (data.error) return res.status(500).json({ error: data.error.message });

    const rawText = data.content?.[0]?.text || "";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const arrayStart = clean.indexOf("[");
    const arrayEnd   = clean.lastIndexOf("]");

    if (arrayStart === -1 || arrayEnd === -1) {
      return res.status(500).json({ error: "AI returned invalid format." });
    }

    const blocks = JSON.parse(clean.substring(arrayStart, arrayEnd + 1));

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(500).json({ error: "AI returned empty routine." });
    }

    return res.status(200).json({ blocks });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
