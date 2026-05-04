// api/send-email.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone } = req.body || {};
  if (!name || !email || !phone) return res.status(400).json({ error: 'Missing fields' });

  const firstName    = name.split(' ')[0];
  const encodedName  = encodeURIComponent(name);
  const encodedEmail = encodeURIComponent(email);
  const encodedPhone = encodeURIComponent(phone);
  const applyUrl     = `https://build.skillslibry.com/grow?name=${encodedName}&email=${encodedEmail}&phone=${encodedPhone}#apply`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     'Evan <evan@build.skillslibry.com>',
        to:       [email],
        reply_to: 'evan@build.skillslibry.com',
        subject:  `${firstName} — this is why your digital product business isn't where it should be`,
        html:     getHtml(firstName, applyUrl),
        text:     getText(firstName, applyUrl),
        headers: {
          'List-Unsubscribe':      '<mailto:evan@build.skillslibry.com?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data });
    }

    console.log('Sent to:', email, '| ID:', data.id);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Crash:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function getText(firstName, applyUrl) {
  return `Hey ${firstName},

I want to be straight with you about something most people in this space won't say.

The reason your digital product business isn't where you want it to be isn't because you don't know enough. You probably know exactly what you need to do.

The problem is you don't have a system that makes you do it — consistently, every single day, in the right order.

That's what Execution OS actually is. Not a course. Not a coaching program. A complete operating system for your business that you log into daily and execute from.

Here's what happens when you plug in:

Step 1 — Revenue Plan
You enter your offer price, monthly target, and niche. The system instantly calculates your exact numbers — how many calls you need to book, how many DMs to send, how many sales to close — and builds your complete 4-week roadmap.

Step 2 — Offer Creation
Using Alex Hormozi's Grand Slam Offer framework, Execution OS engineers your high-ticket offer worth $2,000–$10,000+. Then it generates 3 custom funnel strategies specific to your niche and price point so you know exactly how to hit $20K–$50K/month.

Step 3 — Ideal Customer Avatar
The system generates your full buyer avatar and market intelligence — who they are, what they fear, what they've tried, what makes them buy. Your content, DMs, and sales calls become surgically targeted.

Step 4 — 30-Day Content Calendar
Execution OS builds you a full month of niche-matched content for Facebook and Instagram — posts, Reels, Carousels — with hooks, goals, and CTAs written for your exact audience. You don't think about what to post. You just execute.

Step 5 — DM & Sales Scripts
Niche-tailored scripts for every stage: cold DM openers, warm follow-ups, and high-ticket close frameworks matched to your offer and avatar. You never wonder what to say again.

Step 6 — Daily Routine
Answer a few questions about your schedule and goals and Execution OS builds you a personalised daily routine around your life — so execution becomes automatic, not motivational.

Daily Tracker + Performance HQ
Every day you log your DMs sent, calls booked, and deals closed. Your Health Score updates in real time. Milestones unlock. You see exactly where you are and what needs to happen next.

E-OS Intelligent — Your Business Advisor
An AI advisor that knows your full profile — your niche, offer, avatar, revenue target, and activity history — giving you personalised guidance, not generic advice.

This is a complete operating system. Everything is connected, everything is personalised, and everything is built to keep you executing — not consuming.

If you're ready to stop piecing things together and finally run your business on a system that actually produces $20K–$50K months, book a call with me. I've saved your details so you won't need to fill anything in:

${applyUrl}

Spots this month are almost gone.

Talk soon,
Evan

P.S. — The people inside Execution OS aren't smarter or more talented than you. They just stopped winging it and started executing on a real system. That's the only difference.

---
To unsubscribe reply with "unsubscribe" in the subject.`;
}

function getHtml(firstName, applyUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;">
      <tr>
        <td style="padding:0 0 40px;">

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">Hey ${firstName},</p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">I want to be straight with you about something most people in this space won't say.</p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">The reason your digital product business isn't where you want it to be isn't because you don't know enough. You probably know exactly what you need to do.</p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;"><strong>The problem is you don't have a system that makes you do it</strong> — consistently, every single day, in the right order.</p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">That's what Execution OS actually is. Not a course. Not a coaching program. A complete operating system for your business that you log into daily and execute from.</p>

          <p style="font-size:15px;color:#111;margin:0 0 16px;line-height:1.8;">Here's what happens when you plug in:</p>

          <!-- Step 1 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 1 — Revenue Plan</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">You enter your offer price, monthly target, and niche. The system instantly calculates your exact numbers — calls to book, DMs to send, sales to close — and generates your complete 4-week roadmap.</p>
          </div>

          <!-- Step 2 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 2 — Offer Creation</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">Using Alex Hormozi's Grand Slam Offer framework, Execution OS engineers your high-ticket offer worth $2,000–$10,000+. Then it generates 3 custom funnel strategies for your niche so you know exactly how to hit $20K–$50K/month.</p>
          </div>

          <!-- Step 3 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 3 — Ideal Customer Avatar</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">The system generates your full buyer profile — their fears, what they've tried, what makes them buy. Your content, DMs, and sales calls become surgically targeted.</p>
          </div>

          <!-- Step 4 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 4 — 30-Day Content Calendar</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">A full month of niche-matched content for Facebook and Instagram — posts, Reels, Carousels — with hooks and CTAs written for your exact audience. You don't think about what to post. You just execute.</p>
          </div>

          <!-- Step 5 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 5 — DM & Sales Scripts</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">Niche-tailored scripts for every stage: cold DM openers, warm follow-ups, and high-ticket close frameworks matched to your offer and avatar. You never wonder what to say again.</p>
          </div>

          <!-- Step 6 -->
          <div style="border-left:3px solid #00d68f;padding:12px 16px;margin:0 0 16px;background:#f9fdfb;">
            <p style="font-size:13px;font-weight:bold;color:#00856a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Step 6 — Daily Routine + Tracker</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">A personalised daily routine built around your schedule and goals. Every day you log your DMs, calls, and closes. Your Health Score updates in real time. You always know exactly where you stand.</p>
          </div>

          <!-- E-OS Intelligent -->
          <div style="border-left:3px solid #f0c040;padding:12px 16px;margin:0 0 24px;background:#fdfdf5;">
            <p style="font-size:13px;font-weight:bold;color:#b8880a;margin:0 0 4px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">E-OS Intelligent — Your Business Advisor</p>
            <p style="font-size:14px;color:#111;margin:0;line-height:1.7;">An AI advisor that knows your full profile — niche, offer, avatar, revenue target, and daily activity — giving you personalised strategic guidance, not generic advice.</p>
          </div>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">This is a <strong>complete operating system</strong>. Everything is connected, personalised, and built to keep you executing — not consuming.</p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">If you're ready to stop piecing things together and finally run your business on a system that produces $20K–$50K months, book a call. I've already saved your details so you won't need to fill anything in:</p>

          <p style="margin:0 0 28px;text-align:left;">
            <a href="${applyUrl}" style="display:inline-block;background:#00d68f;color:#06060f;font-family:Arial,sans-serif;font-size:14px;font-weight:700;padding:14px 30px;border-radius:6px;text-decoration:none;">
              Book My Strategy Call →
            </a>
          </p>

          <p style="font-size:15px;color:#111;margin:0 0 20px;line-height:1.8;">Spots this month are almost gone.</p>

          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.8;">Talk soon,</p>
          <p style="font-size:15px;color:#111;font-weight:bold;margin:0 0 4px;">Evan</p>
          <p style="font-size:13px;color:#666;margin:0 0 28px;font-family:Arial,sans-serif;">Execution OS</p>

          <div style="border-top:1px solid #eee;padding-top:18px;">
            <p style="font-size:14px;color:#111;line-height:1.8;font-style:italic;margin:0;">
              <strong>P.S.</strong> — The people inside Execution OS aren't smarter or more talented than you. They stopped winging it and started executing on a real system. That's the only difference.
            </p>
          </div>

        </td>
      </tr>
      <tr>
        <td style="border-top:1px solid #eee;padding-top:16px;text-align:center;">
          <p style="font-size:11px;color:#999;line-height:1.7;margin:0;font-family:Arial,sans-serif;">
            Evan | Execution OS · evan@build.skillslibry.com<br/>
            You received this because you opted in at build.skillslibry.com<br/>
            <a href="mailto:evan@build.skillslibry.com?subject=unsubscribe" style="color:#999;">Unsubscribe</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
