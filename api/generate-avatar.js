export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const {
    niche, price, target,
    av_name, av_age, av_gender, av_location, av_job, av_industry,
    av_employ, av_hrs, av_current, av_desired, av_incomeGoal,
    av_fear, av_tried, av_transformation, av_influences,
    av_objections, av_pain_points, av_keywords
  } = req.body;

  if (!niche || !price || !target) {
    return res.status(400).json({ error: "Missing required fields: niche, price, target." });
  }

  const prompt = `You are an elite market researcher and buyer psychology expert.

Build a complete, deeply personalised buyer avatar for a ${niche} business charging $${Number(price).toLocaleString()} per client, targeting $${Number(target).toLocaleString()}/month revenue.

AVATAR DETAILS PROVIDED:
- Avatar name: ${av_name || 'Not specified'}
- Age: ${av_age || '35'}
- Gender: ${av_gender || 'All genders'}
- Location: ${av_location || 'Not specified'}
- Job/profession: ${av_job || 'Not specified'}
- Industry: ${av_industry || 'Not specified'}
- Employment: ${av_employ || 'Not specified'}
- Hours worked/week: ${av_hrs || 'Not specified'}
- Current situation: ${av_current || 'Not specified'}
- Desired situation: ${av_desired || 'Not specified'}
- Income goal: $${av_incomeGoal || '0'}/month
- Biggest fear: ${av_fear || 'Not specified'}
- Already tried: ${av_tried || 'Not specified'}
- #1 transformation: ${av_transformation || 'Not specified'}
- Influences/communities: ${av_influences || 'Not specified'}
- Objections: ${av_objections || 'Not specified'}
- Selected pain points: ${av_pain_points || 'Not specified'}
- Keywords: ${av_keywords || 'Not specified'}

Generate a complete avatar profile AND content/marketing strategy.

Return ONLY valid JSON with this exact structure:
{
  "avatar": {
    "name": "${av_name || 'Avatar Name'}",
    "age": "${av_age || '35'}",
    "gender": "${av_gender || 'All genders'}",
    "location": "${av_location || 'UK, USA, Australia'}",
    "job": "${av_job || 'Professional'}",
    "industry": "${av_industry || 'Industry'}",
    "employ": "${av_employ || 'Employed'}",
    "hrs": "${av_hrs || '40'}",
    "incomeGoal": "${av_incomeGoal || '10000'}",
    "current": "2-3 sentences describing their current frustrating life situation",
    "desired": "2-3 sentences describing their dream outcome",
    "fear": "${av_fear || 'Fear of failure'}",
    "tried": "${av_tried || 'Various solutions'}",
    "transformation": "${av_transformation || 'Key transformation'}",
    "influences": "${av_influences || 'Industry influencers'}",
    "objections": "${av_objections || 'Main objections'}",
    "pain": "Their core pain in 4-8 words",
    "motivation": "What drives them deeper than money",
    "personality": "Their personality type in 3-5 words",
    "buyerJourney": "3 sentences describing how they discover, evaluate and decide to buy solutions like yours"
  },
  "pains": ["pain point 1", "pain point 2", "pain point 3", "pain point 4", "pain point 5", "pain point 6", "pain point 7", "pain point 8"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "contentPillars": [
    {"pillar": "Pain Awareness", "description": "Content that makes them feel deeply understood", "example": "Specific post example for this niche"},
    {"pillar": "Education", "description": "Teaching the root cause and correct approach", "example": "Specific post example"},
    {"pillar": "Proof & Results", "description": "Social proof and transformation stories", "example": "Specific post example"},
    {"pillar": "Call to Action", "description": "Direct CTA content", "example": "Specific post example"}
  ],
  "dmHooks": ["DM opening hook 1 for ${niche}", "DM opening hook 2", "DM opening hook 3"],
  "objectionHandlers": [
    {"objection": "Common objection 1", "response": "Powerful response that reframes and closes"},
    {"objection": "Common objection 2", "response": "Powerful response"}
  ],
  "marketIntelligence": {
    "marketSize": "Description of market size and opportunity",
    "competition": "Analysis of competition and gap in market",
    "positioning": "How to position uniquely in this niche",
    "pricingPsychology": "Why $${Number(price).toLocaleString()} is the right price point for this avatar",
    "buyingTriggers": ["trigger 1", "trigger 2", "trigger 3"]
  }
}`;

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
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const rawText = data.content?.[0]?.text || "";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const objStart = clean.indexOf("{");
    const objEnd   = clean.lastIndexOf("}");

    if (objStart === -1 || objEnd === -1) {
      return res.status(500).json({ error: "Invalid response format." });
    }

    const result = JSON.parse(clean.substring(objStart, objEnd + 1));
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
