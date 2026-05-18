const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body     = req.body || {};
  const messages = body.messages;
  const model    = body.model      || 'claude-sonnet-4-20250514';
  const maxTok   = body.max_tokens || 1000;
  const system   = body.system;

  if (!messages || !messages.length) {
    return res.status(400).json({ ok: false, error: 'messages required' });
  }

  try {
    const params = { model, max_tokens: maxTok, messages };
    if (system) params.system = system;

    const response = await anthropic.messages.create(params);
    return res.status(200).json(response);

  } catch (err) {
    console.error('[api/claude]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
