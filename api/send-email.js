// api/send-email.js — Vercel Serverless Function
// Plain text only — no HTML, no styling, personal sender tone
// Engineered to hit primary inbox not promotions or spam

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone } = req.body || {};

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const firstName    = name.split(' ')[0];
  const encodedName  = encodeURIComponent(name);
  const encodedEmail = encodeURIComponent(email);
  const encodedPhone = encodeURIComponent(phone);
  const applyUrl     = `https://build.skillslibry.com/grow?name=${encodedName}&email=${encodedEmail}&phone=${encodedPhone}#apply`;

  // ── Plain text body — reads like a personal email from Evan ──────────────
  const textBody = `Hey ${firstName},

I know, it's been a while. And honestly, I've been thinking about you.

Not in a weird way. In a "I hope you haven't given up" kind of way.

Because if you're like most people in my world, you've probably been through this cycle more than once.

You buy a course. You watch the videos. You take notes. You feel motivated for about two weeks, then life happens, and the tab just sits there, open, judging you.

Or maybe you hired a coach. Paid good money. Got a framework, a roadmap, a Notion doc. And still, the funnel isn't working. The leads aren't converting. And you're left wondering what you're missing.

Here's what I've realized.

Most of us have been playing a losing game. We've been trying to learn our way to a business, stacking knowledge on top of knowledge, hoping that eventually it'll click and the revenue will follow.

But growing a digital product business in 2025 doesn't work that way anymore.

What if 90% of the work, the funnels, the follow-up sequences, the content, the lead nurturing, and the onboarding were already built and automated for you?

Not a template you have to customize for six weeks. Not a plug-and-play system that still requires a PhD to set up.

I mean, actually done. Running. Pulling in leads and converting them, while you focus on what you're actually good at.

That's exactly what I break down in this free training I just put together.

No fluff. No pitch. Just the exact shift that's helping people go from "I'm learning and hustling and still stuck" to "my system is working and I'm finally seeing results."

Watch the free training here: ${applyUrl}

If you've ever felt like you're doing everything right but still not getting traction, this is for you.

Go watch it. I think it'll change the way you see everything.

Talk soon,
Evan

P.S. This isn't another course. I promise. Just watch the first 10 minutes and you'll see what I mean.

---
To stop receiving emails from me, reply with "unsubscribe" in the subject.`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Personal sender name — no brand name in from field
        from:     'Evan <evan@build.skillslibry.com>',
        to:       [email],
        reply_to: 'evan@build.skillslibry.com',

        // Lowercase conversational subject — no spam trigger words
        subject:  `${firstName}, I've been thinking about you`,

        // Plain text ONLY — no HTML whatsoever
        // This is the single biggest factor for hitting primary inbox
        text: textBody,

        // Minimal headers — no List-Unsubscribe, no Precedence bulk
        // Those headers tell Gmail it's marketing. Remove them.
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Email failed', detail: data });
    }

    console.log('Email sent:', email, '| ID:', data.id);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Crash:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
