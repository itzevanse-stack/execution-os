const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { q1, q2, q3, target, niche } = body;

  if (!q1 || !q2 || !q3) {
    return res.status(400).json({ ok: false, error: 'All 3 answers required' });
  }

  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      system: 'You are the core intelligence of Execution-OS — a 9-Figure Digital Product Mentor dedicated to helping users build a $100,000/month business. You are known for being direct, honest, and transformational. You do NOT give generic motivation. You respond directly to what the person actually said — naming their specific fear, their specific ceiling, and giving them a precise reframe that rewires how they see their situation.',
      messages: [{
        role: 'user',
        content: 'The person has set a monthly revenue target of $' + (target || 'their target') + ' in the ' + (niche || 'online business') + ' space.\n\n'
          + 'QUESTION 1 — What limiting voice is in their head:\n"' + q1 + '"\n\n'
          + 'QUESTION 2 — Their income ceiling and the story behind it:\n"' + q2 + '"\n\n'
          + 'QUESTION 3 — Their certainty score and what\'s blocking a 10:\n"' + q3 + '"\n\n'
          + 'Write a personalised mindset reframe. Use these exact section headers:\n\n'
          + '**WHAT I HEAR YOU SAYING**\n'
          + '[2-3 sentences that mirror back their exact beliefs using their own words — show them you actually read what they wrote. Name the specific fear or ceiling they described.]\n\n'
          + '**THE TRUTH ABOUT WHERE YOU ARE**\n'
          + '[2-3 sentences of honest, direct reframing. Not "you can do it!" — but a real perspective shift that recontextualises their situation. Reference their specific niche and target.]\n\n'
          + '**THE ONE BELIEF TO INSTALL TODAY**\n'
          + '[One single powerful belief statement written in first-person that they can own immediately.]\n\n'
          + '**YOUR PERMISSION SLIP**\n'
          + '[2 sentences giving them direct permission to move forward despite the fear. End with something that makes them want to take the next step immediately.]\n\n'
          + 'Write in second person. Be direct. Be specific to THEIR words. No fluff. No generic coaching language.'
      }]
    });

    const reframe = (message.content[0] && message.content[0].text) || '';
    return res.status(200).json({ ok: true, reframe });

  } catch (err) {
    console.error('[api/mindset]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
