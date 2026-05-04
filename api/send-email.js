// api/send-email.js — Vercel Serverless Function
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

  const firstName  = name.split(' ')[0];
  const encodedName  = encodeURIComponent(name);
  const encodedEmail = encodeURIComponent(email);
  const encodedPhone = encodeURIComponent(phone);

  // Pre-filled apply link — skips the form when they click
  const applyUrl = `https://build.skillslibry.com/grow?name=${encodedName}&email=${encodedEmail}&phone=${encodedPhone}#apply`;

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
        subject:  `${firstName} — quick message`,
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

// ── Plain text (primary inbox signals) ───────────────────────────────────────
function getText(firstName, applyUrl) {
  return `Hey ${firstName},

Glad you made it over — wanted to reach out personally.

Most people I speak to who are building digital product businesses aren't struggling because they don't know enough. They're struggling because they're not executing consistently.

They've got the courses. They've watched the videos. They know what a funnel is.

But nothing is actually moving.

That's the gap Execution OS closes.

It's not a course. It's not coaching. It's the exact system we run our own business on — the one getting us to $50K months — structured so you can plug straight in and start executing this week.

Here's what it gives you:

- A proven offer that sells even in saturated markets
- An automated traffic system that works while you sleep
- A conversion system that turns cold audiences into buyers
- A scale playbook that compounds month after month
- Done-with-you implementation from day one

If you're serious about finally getting your digital product business to where it should be, I want to get on a quick call and show you exactly how this works for your situation.

Click below to book your spot — I've already saved your details so you won't need to fill anything in again:

${applyUrl}

Spots are limited this month. Don't sit on this.

Talk soon,
Evan

P.S. — Most people who book a call with me walk away with more clarity in 30 minutes than they got from months of courses. The call is free. The system works. The only question is whether you're ready.

---
To unsubscribe reply with "unsubscribe" in the subject.`;
}

// ── HTML (minimal — looks personal, not like a newsletter) ───────────────────
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
        <td style="padding:0 0 32px;">
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            Hey ${firstName},
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            Glad you made it over — wanted to reach out personally.
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            Most people I speak to who are building digital product businesses aren't struggling because they don't know enough. They're struggling because they're <strong>not executing consistently.</strong>
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            They've got the courses. They've watched the videos. They know what a funnel is.
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            But nothing is actually moving.
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            That's the gap <strong>Execution OS</strong> closes.
          </p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            It's not a course. It's not coaching. It's the exact system we run our own business on — the one getting us to $50K months — structured so you can plug straight in and start executing this week.
          </p>

          <p style="font-size:15px;color:#111;margin:0 0 10px;line-height:1.7;">Here's what it gives you:</p>
          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.7;">✓ &nbsp;A proven offer that sells even in saturated markets</p>
          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.7;">✓ &nbsp;An automated traffic system that works while you sleep</p>
          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.7;">✓ &nbsp;A conversion system that turns cold audiences into buyers</p>
          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.7;">✓ &nbsp;A scale playbook that compounds month after month</p>
          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">✓ &nbsp;Done-with-you implementation from day one</p>

          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            If you're serious about finally getting your digital product business to where it should be, I want to get on a quick call and show you exactly how this works for your situation.
          </p>

          <!-- CTA — simple text link style, not a big button -->
          <p style="font-size:15px;color:#111;margin:0 0 8px;line-height:1.7;">
            Click below to book your spot — <strong>I've already saved your details so you won't need to fill anything in again:</strong>
          </p>
          <p style="margin:0 0 28px;">
            <a href="${applyUrl}"
               style="display:inline-block;background:#00d68f;color:#06060f;font-family:Arial,sans-serif;font-size:14px;font-weight:700;padding:13px 28px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">
              Book My Strategy Call →
            </a>
          </p>

          <p style="font-size:15px;color:#111;margin:0 0 18px;line-height:1.7;">
            Spots are limited this month. Don't sit on this.
          </p>

          <p style="font-size:15px;color:#111;margin:0 0 6px;line-height:1.7;">Talk soon,</p>
          <p style="font-size:15px;color:#111;font-weight:bold;margin:0 0 4px;">Evan</p>
          <p style="font-size:13px;color:#666;margin:0 0 28px;">Execution OS</p>

          <p style="font-size:14px;color:#111;margin:0;line-height:1.7;border-top:1px solid #eee;padding-top:18px;">
            <em><strong>P.S.</strong> — Most people who book a call with me walk away with more clarity in 30 minutes than they got from months of courses. The call is free. The system works. The only question is whether you're ready.</em>
          </p>
        </td>
      </tr>

      <tr>
        <td style="border-top:1px solid #eee;padding-top:16px;text-align:center;">
          <p style="font-size:11px;color:#999;line-height:1.7;margin:0;">
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
