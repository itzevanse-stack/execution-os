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

  const prompt = `You are an elite performance coach. Build a personalized daily routine as a JSON array.

User profile:
- Wake time: ${wake}, Bedtime: ${sleep}
- Job: ${job}, Business time available: ${biztime}
- Areas to develop: ${areas}
- Weakness: ${weakness}
- Habit to break: ${addiction}
- Limiting belief: "${belief}"
- Exercise level: ${exercise} — preferred style: ${extype}
- Life goal: ${lifegoal}
- Identity goal: "${identity}"
- Monthly income target: $${Number(target).toLocaleString()}, Niche: ${niche}

Return ONLY a valid JSON array. No markdown. No explanation. Just the raw JSON array.

Each element is either:
1. A section header: {"section":"🌅  Section Title  ·  Time Range"}
2. A routine block: {"time":"6:00 AM","dur":"20 min","icon":"🙏","title":"Block title","why":"2-3 sentence explanation specific to this user.","tag":"Category","tagColor":"rgba(78,204,163,.12)","tagText":"var(--teal)","accent":"var(--teal)"}

Tag color options:
- Health/body: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"
- Spiritual/faith: tagColor "rgba(108,99,255,.12)", tagText "var(--purple)", accent "var(--purple)"
- Revenue/income: tagColor "rgba(255,217,61,.12)", tagText "var(--yellow)", accent "var(--yellow)"
- Content creation: tagColor "rgba(225,48,108,.12)", tagText "#f472b6", accent "#e1306c"
- Mindset/growth: tagColor "rgba(255,107,107,.1)", tagText "var(--red)", accent "var(--red)"
- Business tasks: tagColor "rgba(255,140,66,.15)", tagText "#ff8c42", accent "var(--orange)"
- Recovery/rest: tagColor "rgba(78,204,163,.12)", tagText "var(--teal)", accent "var(--teal)"

Rules:
- Schedule MUST fit between ${wake} and ${sleep}
- Include ${biztime} of dedicated business blocks
- Add block(s) specifically to break: "${addiction}"
- Address limiting belief "${belief}" via journaling or affirmation
- Include exercise matching: ${extype}
- Cover all these areas: ${areas}
- 3-5 section headers, 12-18 routine blocks total
- ONLY return the JSON array — no markdown, no explanation`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const parsed = await response.json();

    if (parsed.error) {
      return res.status(500).json({ error: parsed.error.message });
    }

    const rawText = parsed.choices?.[0]?.message?.content || "";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const blocks = JSON.parse(clean);

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(500).json({ error: "AI returned invalid format" });
    }

    return res.status(200).json({ blocks });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
