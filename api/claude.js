import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, max_tokens, messages, system } = req.body || {};

  if (!messages || !messages.length) {
    return res.status(400).json({ ok: false, error: 'messages required' });
  }

  try {
    const response = await anthropic.messages.create({
      model:      model      || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1000,
      ...(system ? { system } : {}),
      messages,
    });

    return res.status(200).json(response);

  } catch (err) {
    console.error('[api/claude]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
