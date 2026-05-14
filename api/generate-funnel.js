// api/generate-funnel.js — Vercel serverless function
// Uses streaming to avoid timeout on long generations
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables.' });

  const { prompt, max_tokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Cap tokens at 5000 to stay within timeout limits
  const tokens = Math.min(max_tokens || 5000, 5000);

  try {
    // Use streaming — collect chunks and return when done
    // This keeps the connection alive and avoids gateway timeout
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'interleaved-thinking-2025-05-14',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: tokens,
        stream:     true,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      return res.status(response.status).json(err);
    }

    // Stream the response — collect text deltas
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';
    let buffer    = '';

    res.setHeader('Content-Type', 'application/json');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text;
          }
          if (parsed.type === 'message_stop') break;
        } catch(e) {}
      }
    }

    // Return in the same format the client expects
    return res.status(200).json({
      content: [{ type: 'text', text: fullText }],
      model: 'claude-sonnet-4-6',
    });

  } catch (err) {
    console.error('generate-funnel error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
