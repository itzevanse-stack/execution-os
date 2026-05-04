// api/send-email.js
// Simple Vercel Serverless Function — sends opt-in email via Resend

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone } = req.body || {};

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const firstName = name.split(' ')[0];
  const PAGE_URL  = 'https://build.skillslibry.com/grow';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     'Evan | Execution OS <evan@build.skillslibry.com>',
        to:       [email],
        reply_to: 'evan@build.skillslibry.com',
        subject:  `${firstName}, you're one system away from $50K/month`,
        html:     getEmailHtml(firstName, PAGE_URL),
        text:     getEmailText(firstName, PAGE_URL),
        headers: {
          'List-Unsubscribe':      '<mailto:evan@build.skillslibry.com?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'Precedence':            'bulk',
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Email failed', detail: data });
    }

    console.log('Email sent to:', email, '| Resend ID:', data.id);
    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    console.error('Function crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Plain text ────────────────────────────────────────────────────────────────
function getEmailText(firstName, pageUrl) {
  return `Hey ${firstName},

You just made one of the most important decisions for your digital product business.

Let me be direct — most people building digital product businesses are NOT failing because they lack information. They have YouTube, courses, free PDFs. They know what a funnel is. They know they need an offer.

And yet they're still stuck.

Here's the truth nobody will tell you:

"You don't have an information problem. You have an execution problem."

Every week you spend consuming content instead of executing is a week your competitors are building their audience, launching offers, and stacking income.

The gap between where you are and $50K/month is not knowledge. It's a system.

WHY EXECUTION OS IS DIFFERENT
-------------------------------
This is not a course. Not a coaching program where you pay $5,000 for generic Zoom advice.

Execution OS is the exact operating system we run our own digital product business on — the same one producing $50K months — handed directly to you, plug-and-play.

✓ A proven offer framework that sells even in saturated markets
✓ An automated traffic system that fills your funnel while you sleep
✓ A conversion system that turns cold audiences into paying customers
✓ A scale playbook that compounds your results month after month
✓ Done-with-you implementation — not "watch this video and figure it out"

THIS IS THE ONLY THING MISSING IN YOUR BUSINESS
-------------------------------------------------
I've spoken to hundreds of digital product creators. Always the same pattern — smart, motivated, hardworking. But running on strategy fragments instead of a complete system.

Execution OS gives you the complete picture. One system. One direction. One path to 6 and 7 figures.

If you haven't booked your call yet:
→ ${pageUrl}#apply

Spots are limited. Every day you wait is a day someone else takes your spot.

Talk soon,
Evan S.E
Founder, Execution OS

---
You're receiving this because you opted in at build.skillslibry.com
© 2025 Execution OS
To unsubscribe reply with "unsubscribe" in the subject.`;
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function getEmailHtml(firstName, pageUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#06060f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060f;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:600px;background:#0d0d1e;border-radius:16px;border:1px solid rgba(0,214,143,0.18);overflow:hidden;">

      <tr>
        <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(0,214,143,0.12);">
          <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">
            <span style="color:#00d68f;">Execution</span>OS
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#8080a8;margin-top:6px;">
            The System Behind $50K/Month Digital Product Businesses
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:36px 40px;">
          <p style="font-size:16px;color:#00d68f;font-weight:700;margin:0 0 6px;">Hey ${firstName},</p>
          <p style="font-size:15px;color:#fff;font-weight:800;line-height:1.4;margin:0 0 20px;">
            You just made one of the most important decisions for your digital product business.
          </p>
          <p style="font-size:14px;color:#c0c0d8;line-height:1.8;margin:0 0 16px;">
            Let me be direct — because I respect your time too much to waste it.
          </p>
          <p style="font-size:14px;color:#c0c0d8;line-height:1.8;margin:0 0 16px;">
            <strong style="color:#fff;">Most people building digital product businesses are NOT failing because they lack information.</strong>
            They have YouTube, courses, free PDFs. They know what a funnel is. They know they need an offer.
          </p>
          <p style="font-size:14px;color:#c0c0d8;line-height:1.8;margin:0 0 24px;">
            And yet — <strong style="color:#f0c040;">they're still stuck.</strong> Still posting without sales.
            Still tweaking their funnel for the 9th time. Still watching others hit $20K, $30K, $50K months.
          </p>

          <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(0,214,143,0.3),transparent);margin:28px 0;"></div>

          <p style="font-size:18px;color:#fff;font-weight:900;margin:0 0 16px;">Here's the truth nobody will tell you:</p>
          <div style="background:rgba(0,214,143,0.07);border-left:3px solid #00d68f;border-radius:0 8px 8px 0;padding:18px 20px;margin:0 0 24px;">
            <p style="font-size:15px;color:#fff;font-weight:700;line-height:1.6;margin:0;">
              "You don't have an information problem. You have an <span style="color:#00d68f;">execution problem.</span>"
            </p>
          </div>
          <p style="font-size:14px;color:#c0c0d8;line-height:1.8;margin:0 0 28px;">
            The gap between where you are and $50K/month is not knowledge. It's a
            <strong style="color:#f0c040;">system</strong> — repeatable, proven, automated — that replaces
            guesswork with daily actions that compound into life-changing income.
          </p>

          <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(240,192,64,0.3),transparent);margin:28px 0;"></div>

          <p style="font-size:18px;color:#fff;font-weight:900;margin:0 0 14px;">Why Execution OS Is Different</p>
          <p style="font-size:14px;color:#c0c0d8;line-height:1.8;margin:0 0 20px;">
            Not a course. Not a $5,000 coaching program with generic Zoom advice.
            Execution OS is the <strong style="color:#00d68f;">exact operating system</strong> running our
            $50K/month business — handed to you, plug-and-play, starting this week.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#00d68f;font-weight:800;">✓</span>
              <span style="font-size:14px;color:#c0c0d8;margin-left:10px;">A <strong style="color:#fff;">proven offer framework</strong> that sells even in saturated markets</span>
            </td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#00d68f;font-weight:800;">✓</span>
              <span style="font-size:14px;color:#c0c0d8;margin-left:10px;">An <strong style="color:#fff;">automated traffic system</strong> that fills your funnel while you sleep</span>
            </td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#00d68f;font-weight:800;">✓</span>
              <span style="font-size:14px;color:#c0c0d8;margin-left:10px;">A <strong style="color:#fff;">conversion system</strong> that turns cold audiences into paying customers</span>
            </td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="color:#00d68f;font-weight:800;">✓</span>
              <span style="font-size:14px;color:#c0c0d8;margin-left:10px;">A <strong style="color:#fff;">scale playbook</strong> that compounds results month after month</span>
            </td></tr>
            <tr><td style="padding:10px 0;">
              <span style="color:#00d68f;font-weight:800;">✓</span>
              <span style="font-size:14px;color:#c0c0d8;margin-left:10px;"><strong style="color:#fff;">Done-with-you implementation</strong> — not "watch this video and figure it out"</span>
            </td></tr>
          </table>

          <div style="background:linear-gradient(135deg,rgba(0,214,143,0.1),rgba(240,192,64,0.08));border:1px solid rgba(0,214,143,0.25);border-radius:12px;padding:28px;text-align:center;margin:0 0 32px;">
            <p style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#00d68f;margin:0 0 8px;">Haven't Booked Your Call Yet?</p>
            <p style="font-size:20px;color:#fff;font-weight:900;line-height:1.3;margin:0 0 8px;">Your $50K/Month Business<br/>Is One Click Away</p>
            <p style="font-size:13px;color:#8080a8;line-height:1.6;margin:0 0 20px;">
              Spots are limited. Every day you wait is a day someone else takes your spot.
            </p>
            <a href="${pageUrl}#apply"
               style="display:inline-block;background:linear-gradient(135deg,#00d68f,#00b87a);color:#06060f;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;padding:14px 32px;border-radius:6px;text-decoration:none;">
              APPLY NOW — CLAIM YOUR SPOT →
            </a>
            <p style="font-size:11px;color:#44445a;margin:14px 0 0;">⚡ Limited spots open this month</p>
          </div>

          <p style="font-size:14px;color:#c0c0d8;margin:0 0 6px;">Talk soon,</p>
          <p style="font-size:15px;color:#fff;font-weight:800;margin:0 0 4px;">Evan S.E</p>
          <p style="font-size:12px;color:#8080a8;margin:0;">Founder, Execution OS</p>
        </td>
      </tr>

      <tr>
        <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
          <p style="font-size:11px;color:#44445a;line-height:1.8;margin:0;">
            You received this because you opted in at
            <a href="${pageUrl}" style="color:#44445a;">build.skillslibry.com</a><br/>
            © 2025 Execution OS · All Rights Reserved<br/>
            <a href="mailto:evan@build.skillslibry.com?subject=unsubscribe" style="color:#44445a;">Unsubscribe</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
