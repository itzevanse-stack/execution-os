// api/claude.js — Vercel serverless function
// Proxies requests to Anthropic API, adds API key server-side
// Place this file at: /api/claude.js in your GitHub repo

export default async function handler(req, res) {
  // ── CORS headers — allow requests from your domain ──────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set in Vercel environment variables');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const body = req.body;

    // Build the Anthropic request — support both messages array and legacy prompt
    const anthropicBody = {
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
    };

    // Support messages array (new format)
    if (body.messages && Array.isArray(body.messages)) {
      anthropicBody.messages = body.messages;
    }
    // Support legacy single prompt
    else if (body.prompt) {
      anthropicBody.messages = [{ role: 'user', content: body.prompt }];
    }
    else {
      return res.status(400).json({ error: 'Request must include messages array or prompt' });
    }

    // Support system prompt if provided
    if (body.system) {
      anthropicBody.system = body.system;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, data);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
