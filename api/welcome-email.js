// api/welcome-email.js
// Sends a welcome email when a new user creates their account

import { Resend } from 'resend';

const FROM_EMAIL = 'Execution OS <evan@build.skillslibrary.com>';

const PLAN_LABELS = {
  'affiliate_monthly': 'Affiliate Mode — Monthly',
  'affiliate_annual':  'Affiliate Mode — Real Builder 🏆',
  'expert_monthly':    'Expert Mode — Monthly',
  'expert_annual':     'Expert Mode — Real Builder 🏆',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, plan, mode } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  const firstName   = (name || 'there').split(' ')[0];
  const planLabel   = PLAN_LABELS[plan] || (mode === 'expert' ? 'Expert Mode' : 'Affiliate Mode');
  const isExpert    = mode === 'expert' || (plan && plan.includes('expert'));
  const isRealBuilder = plan && plan.includes('annual');

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin:0; padding:0; background:#06060f; font-family:'Helvetica Neue',Arial,sans-serif; color:#ffffff; }
    .wrap { max-width:600px; margin:0 auto; padding:40px 24px; }
    .logo { text-align:center; margin-bottom:32px; }
    .logo-icon { display:inline-block; width:56px; height:56px; background:linear-gradient(135deg,#4ecca3,#0d9488); border-radius:16px; font-size:28px; line-height:56px; text-align:center; margin-bottom:12px; }
    .logo-name { font-size:20px; font-weight:900; color:#ffffff; letter-spacing:-0.5px; }
    .logo-sub { font-size:11px; color:rgba(255,255,255,.4); text-transform:uppercase; letter-spacing:2px; margin-top:2px; }
    .card { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:20px; padding:36px 32px; margin-bottom:24px; }
    h1 { font-size:28px; font-weight:900; color:#ffffff; margin:0 0 8px; line-height:1.2; }
    p { font-size:14px; color:rgba(255,255,255,.7); line-height:1.8; margin:0 0 16px; }
    .plan-badge { display:inline-block; background:rgba(78,204,163,.12); border:1px solid rgba(78,204,163,.3); border-radius:50px; padding:8px 20px; font-size:12px; font-weight:700; color:#4ecca3; margin-bottom:24px; }
    .step { display:flex; gap:16px; align-items:flex-start; margin-bottom:20px; }
    .step-num { width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#4ecca3,#0d9488); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:900; color:#06060f; flex-shrink:0; }
    .step-content { flex:1; }
    .step-title { font-size:14px; font-weight:800; color:#ffffff; margin-bottom:4px; }
    .step-sub { font-size:12px; color:rgba(255,255,255,.5); line-height:1.6; }
    .cta-btn { display:block; text-align:center; background:linear-gradient(135deg,#4ecca3,#0d9488); color:#06060f; font-size:16px; font-weight:900; padding:18px 32px; border-radius:14px; text-decoration:none; margin:24px 0; letter-spacing:0.3px; }
    .divider { border:none; border-top:1px solid rgba(255,255,255,.08); margin:24px 0; }
    .footer { text-align:center; font-size:11px; color:rgba(255,255,255,.3); line-height:1.8; }
    .highlight { color:#4ecca3; font-weight:700; }
    .gold { color:#F5C842; font-weight:700; }
  </style>
</head>
<body>
  <div class="wrap">

    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div class="logo-name">Execution OS</div>
      <div class="logo-sub">Execution Partner</div>
    </div>

    <div class="card">
      <h1>You're in, ${firstName}.</h1>
      <p>Your account is live. Your system is ready. The only thing left is to start.</p>
      <div class="plan-badge">${planLabel}${isRealBuilder ? ' · Price locked forever' : ''}</div>

      <p>Here is exactly what to do in the next <span class="highlight">17 minutes</span>:</p>

      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <div class="step-title">Complete your Foundation setup</div>
          <div class="step-sub">Tell the system your niche, your offer and your ideal buyer. This is what makes every output specific to you — not generic. Takes 17 minutes.</div>
        </div>
      </div>

      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <div class="step-title">${isExpert ? 'Run your Boardroom build' : 'Set up your Affiliate offer'}</div>
          <div class="step-sub">${isExpert ? 'The Boardroom builds your full business strategy — offer positioning, content angles, copy vault, war plan. All in one click.' : 'Connect your affiliate product. The system builds your content strategy, DM scripts and daily plan around it automatically.'}</div>
        </div>
      </div>

      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <div class="step-title">Post your first piece of content</div>
          <div class="step-sub">Go to Content Studio. Generate your first Quote Card or Value Post. Download it. Post it. Your first day of execution is done.</div>
        </div>
      </div>

      <a href="https://build.skillslibry.com/app" class="cta-btn">Enter Execution OS →</a>

      <hr class="divider">

      <p style="font-size:13px">The difference between where you are now and where you want to be is not more knowledge. You have everything you need. <span class="highlight">Now execute.</span></p>

      <p style="font-size:13px;margin-bottom:0">To your success,<br><strong style="color:#ffffff">Evan SE</strong><br><span style="color:rgba(255,255,255,.4);font-size:12px">Founder, Execution OS</span></p>
    </div>

    ${isRealBuilder ? `
    <div class="card" style="border-color:rgba(245,200,66,.2);background:rgba(245,200,66,.04)">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#F5C842;margin-bottom:8px">🏆 Real Builder Status</div>
      <p style="font-size:13px;margin:0">Your price is locked forever. As we grow and raise prices, you pay what you paid today — for life. That is the Real Builder guarantee.</p>
    </div>` : ''}

    <div class="footer">
      You're receiving this because you created an account on Execution OS.<br>
      <a href="https://build.skillslibry.com" style="color:rgba(255,255,255,.3)">build.skillslibry.com</a>
    </div>

  </div>
</body>
</html>`;

  const textBody = `
You're in, ${firstName}.

Your Execution OS account is live. Plan: ${planLabel}

Here's what to do in the next 17 minutes:

1. Complete your Foundation setup — niche, offer, ideal buyer. This is what makes everything specific to you.

2. ${isExpert ? 'Run your Boardroom build — full business strategy in one click.' : 'Set up your Affiliate offer — the system builds your content strategy around it.'}

3. Post your first piece of content — go to Content Studio, generate a Quote Card or Value Post, post it.

Enter the platform: https://build.skillslibry.com/app

To your success,
Evan SE
Founder, Execution OS
  `.trim();

  try {
    const resend = new Resend(RESEND_KEY);
    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      email,
      subject: `You're in, ${firstName}. Let's build.`,
      html:    htmlBody,
      text:    textBody,
    });
    console.log('[welcome-email] ✅ Sent to:', email);
    return res.status(200).json({ success: true });
  } catch(e) {
    console.error('[welcome-email] ❌ Failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
