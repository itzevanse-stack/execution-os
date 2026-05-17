// api/claude.js — Vercel Edge Runtime
// Edge Runtime has NO execution timeout (vs 10s/60s for Node.js serverless)
// This eliminates FUNCTION_INVOCATION_TIMEOUT on long AI responses.

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  try {
    const body = await req.json();
    let messages = [];

    if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
    } else if (body.prompt) {
      messages = [{ role: 'user', content: body.prompt }];
    } else {
      return new Response(
        JSON.stringify({ error: 'Request must include messages array or prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // ── fetchUrl: scrape a webpage and prepend its content ──────────────────
    if (body.fetchUrl) {
      try {
        const pageResp = await fetch(body.fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ExecutionOS/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(8000),
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
              {
                role: 'user',
                content:
                  'SALES PAGE CONTENT (from ' +
                  body.fetchUrl +
                  '):\n\n' +
                  html +
                  '\n\n---\n\n' +
                  messages[0].content,
              },
              ...messages.slice(1),
            ];
          }
        }
      } catch (fetchErr) {
        console.warn('fetchUrl failed:', fetchErr.message);
      }
    }

    // ── Build Anthropic request ──────────────────────────────────────────────
    const anthropicBody = {
      model:      body.model      || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
      messages,
    };
    if (body.system) anthropicBody.system = body.system;

    // ── Call Anthropic API ───────────────────────────────────────────────────
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
      console.error('Anthropic error:', response.status, JSON.stringify(data));
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    console.error('Edge proxy error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
