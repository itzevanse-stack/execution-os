// api/claude.js — Vercel serverless function (CommonJS)
// Proxies requests to Anthropic API, adds API key server-side
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' });
  }

  try {
    const body = req.body;
    let messages = [];

    if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
    } else if (body.prompt) {
      messages = [{ role: 'user', content: body.prompt }];
    } else {
      return res.status(400).json({ error: 'Request must include messages array or prompt' });
    }

    // ── fetchUrl: fetch the webpage and prepend its content ──
    if (body.fetchUrl) {
      try {
        const pageResp = await fetch(body.fetchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExecutionOS/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(8000)
        });
        if (pageResp.ok) {
          let html = await pageResp.text();
          html = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t\r\n]{2,}/g, ' ')
            .trim()
            .substring(0, 6000);
          if (messages.length > 0 && html.length > 100) {
            messages = [
              { role: 'user', content: 'SALES PAGE CONTENT (from ' + body.fetchUrl + '):\n\n' + html + '\n\n---\n\n' + messages[0].content },
              ...messages.slice(1)
            ];
          }
        }
      } catch(fetchErr) {
        console.warn('fetchUrl failed:', fetchErr.message);
      }
    }

    const anthropicBody = {
      model:      body.model      || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
      messages,
    };
    if (body.system) anthropicBody.system = body.system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', response.status, data);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
