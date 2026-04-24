export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });

  const { type, productUrl, productName, commission, monthlyTarget, niche, trafficMode, avatarData } = req.body;
  const av = avatarData || {};

  // ── AVATAR — requires real product URL ────────────────────────────────
  if (type === 'avatar') {

    // Validate: must have URL or product name at minimum
    if (!productUrl && !productName) {
      return res.status(400).json({ error: "Please paste your affiliate product URL before analysing." });
    }

    // Scrape the product page if URL provided
    let pageContent = '';
    if (productUrl) {
      try {
        const pageResp = await fetch(productUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          signal: AbortSignal.timeout(12000)
        });

        if (pageResp.ok) {
          const html = await pageResp.text();
          // Extract meaningful text from the page
          pageContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .substring(0, 6000)
            .trim();
        }
      } catch (scrapeErr) {
        console.warn('Page scrape failed:', scrapeErr.message);
        // Continue without page content — use product name + niche
      }
    }

    const contextSection = pageContent
      ? `REAL PRODUCT PAGE CONTENT (scraped from ${productUrl}):\n"""\n${pageContent}\n"""\n\nBase ALL analysis on this actual page content. Extract real claims, real benefits, real promises.`
      : `Product: "${productName || 'Not provided'}"\nNiche: ${niche || 'Online Business'}\nNote: No product URL provided — generate based on product name and niche only.`;

    const prompt = `You are an elite market researcher and buyer psychology expert.

An affiliate marketer wants to promote this product:
${contextSection}

Commission per sale: $${Number(commission || 1000).toLocaleString()}
Monthly revenue target: $${Number(monthlyTarget || (Number(commission)||1000) * 5).toLocaleString()}
Traffic strategy: ${trafficMode || 'organic'}

Based on the ACTUAL product page content above, identify:
- Who this product is genuinely designed for
- What real pain points it addresses
- What transformation it promises
- What objections a buyer would have

Then build a precise buyer avatar for this SPECIFIC product.

Return ONLY valid JSON — no markdown, no explanation:
{
  "name": "Avatar name matching this product's real target buyer",
  "age": "Most common buyer age range",
  "gender": "Primary gender demographic",
  "location": "Primary locations this product targets",
  "job": "Exact job title of the ideal buyer",
  "industry": "Their industry",
  "income": "Their current income range",
  "current": "2 sentences: their specific frustrating situation that makes THIS product relevant",
  "desired": "2 sentences: the exact outcome THIS product promises them",
  "incomeGoal": "${monthlyTarget || 10000}",
  "transformation": "The #1 transformation THIS product delivers — based on real product claims",
  "fear": "Their biggest fear about buying a product like this",
  "tried": "Specific things they have already tried that failed",
  "pain": "Core pain in 5–7 words — specific to this product's market",
  "motivation": "What drives them beyond money",
  "personality": "3-word personality description",
  "influences": "3 real influencers or communities in this exact niche",
  "objections": "Top 2 objections specific to this product's price point and claims",
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"],
  "productName": "${productName || 'the product'}",
  "productUrl": "${productUrl || ''}",
  "commission": ${Number(commission || 1000)},
  "niche": "${niche || 'Online Business'}",
  "realClaims": ["Actual claim from the product page 1", "Actual claim 2", "Actual claim 3"],
  "contentAngles": [
    "Content angle based on real product benefit 1",
    "Content angle based on real product benefit 2",
    "Content angle based on real product benefit 3"
  ],
  "dmStrategy": "2 sentences on the best DM approach based on this specific product's audience and price point"
}`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const d = await r.json();
      if (d.error) return res.status(500).json({ error: d.error.message });
      const raw = (d.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s === -1) return res.status(500).json({ error: "Invalid response format." });
      const result = JSON.parse(raw.substring(s, e + 1));
      // Include whether we had real page data
      result._hadPageContent = pageContent.length > 100;
      result._pageScraped = !!productUrl;
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── CALENDAR — Haiku, fast, uses real avatar data ─────────────────────
  if (type === 'calendar') {

    const realClaims = (av.realClaims || []).join(', ') || 'the product benefits';
    const contentAngles = (av.contentAngles || []).join(' | ') || '';

    const prompt = `You are an expert affiliate content copywriter.

PRODUCT: "${av.productName || productName || 'affiliate product'}"
${av.productUrl ? `PRODUCT URL: ${av.productUrl}` : ''}
COMMISSION: $${Number(commission || av.commission || 1000).toLocaleString()} per sale
NICHE: ${niche || av.niche || 'Online Business'}
TRAFFIC: ${trafficMode === 'paid' ? 'Paid Ads' : 'Organic Content + DMs'}

REAL PRODUCT CLAIMS (from the actual product page):
${realClaims}

BUYER AVATAR (built from real product data):
- Who they are: ${av.job || 'professional'} in ${av.industry || 'their field'}
- Core pain: "${av.pain || 'their main struggle'}"
- What they want: "${av.transformation || 'their desired outcome'}"
- Their fear: "${av.fear || 'wasting money'}"
- Already tried: "${av.tried || 'various solutions'}"
- What motivates them: "${av.motivation || 'freedom and success'}"

CONTENT ANGLES (based on real product benefits):
${contentAngles}

WEEK STRATEGY:
- Days 1–3: Educate about the PROBLEM. Never mention the product. Build trust.
- Days 4–5: Introduce the product naturally using its REAL claims and benefits.
- Days 6–7: Drive action. Use real testimonials tone. Clear CTA.

Write ALL 7 DAYS of content. Each day = different angle and emotional trigger.

FORMAT for each day:

DAY [N]: [Specific topic tied to real product benefits]

FACEBOOK POST (200–260 words):
[Full post. First line stops scroll. Short paragraphs. Perfect grammar. Specific to this audience. End with a question.]

REEL 1 (35–45 seconds):
HOOK: [First 3 seconds — specific to this niche's pain]
SCRIPT: [Word-for-word. Natural. References real pain or transformation.]
CAPTION: [2 lines + 5 niche hashtags]

REEL 2 (35–45 seconds):
HOOK: [Different angle from Reel 1]
SCRIPT: [3 teaching points. Natural speech.]
CAPTION: [2 lines + 5 hashtags]

EMAIL:
SUBJECT: [Under 45 chars — specific, not generic]
PREVIEW: [Under 80 chars]
BODY: [200–240 words. One real insight. One action. Sign-off with name.]

RULES:
- Perfect grammar throughout — every sentence
- Active voice always
- Sound like a real human who uses this product — not AI
- Reference REAL pain points, REAL transformations from the product
- Never mention commission or that it is affiliate marketing
- Never use: "game-changer", "journey", "in today's world", "let's be honest"`;

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

  return res.status(400).json({ error: "Invalid type." });
}
