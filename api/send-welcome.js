export default async function handler(req, res) {
  // Allow CORS from your domain
  res.setHeader('Access-Control-Allow-Origin', 'https://build.skillslibry.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  const firstName = name ? name.split(' ')[0] : 'there';
  const loginLink = 'https://build.skillslibry.com/app.html';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4ecca3,#3da88a);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
      <div style="font-size:22px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0d0d1a">EXECUTION OS</div>
      <div style="font-size:12px;color:#0d0d1a;margin-top:4px;font-weight:600;opacity:.75;letter-spacing:.5px">YOUR ACCESS IS NOW ACTIVE</div>
    </div>

    <!-- Body -->
    <div style="background:#1a1a3e;border:1px solid rgba(78,204,163,.15);border-top:none;border-radius:0 0 16px 16px;padding:32px">

      <p style="font-size:16px;font-weight:700;color:#ffffff;margin:0 0 6px">Hey ${firstName} 👋</p>
      <p style="font-size:14px;color:#b0b0d0;line-height:1.7;margin:0 0 24px">
        Evan here. I just activated your full access to <strong style="color:#4ecca3">Execution OS</strong>.<br>
        Everything is built and ready for you right now — let's get to work.
      </p>

      <!-- Login Steps -->
      <div style="background:rgba(78,204,163,.07);border:1px solid rgba(78,204,163,.2);border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4ecca3;font-weight:900;margin-bottom:14px">🔑 How to log in</div>
        <div style="font-size:13px;color:#e8e8e8;line-height:2.2">
          <div><span style="color:#4ecca3;font-weight:700">1.</span> Go to: <a href="${loginLink}" style="color:#4ecca3;font-weight:700;text-decoration:none">${loginLink}</a></div>
          <div><span style="color:#4ecca3;font-weight:700">2.</span> Click <strong style="color:#fff">"Sign In"</strong></div>
          <div><span style="color:#4ecca3;font-weight:700">3.</span> Use this email: <strong style="color:#ffd93d">${email}</strong></div>
          <div><span style="color:#4ecca3;font-weight:700">4.</span> Click <strong style="color:#fff">"Forgot Password"</strong> to set your password on first login</div>
        </div>
      </div>

      <!-- What's Inside -->
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#b0b0d0;font-weight:900;margin-bottom:14px">⚡ What's inside your account</div>
        ${[
          ['📊', 'Revenue Plan', 'Your exact daily numbers, DMs, calls and closes to hit your target'],
          ['🎯', 'Offer Creation', 'Your high-ticket offer built specifically for your niche'],
          ['📅', 'Content Calendar', '30 days of niche-tailored posts, reels and emails — ready to use'],
          ['💬', 'DM Scripts', '10 niche-specific scripts that start conversations and close deals'],
          ['⚡', 'Daily Tracker', 'Track every action daily — what gets measured gets done'],
          ['🔥', 'Daily Routine', 'Your personal AI-built power schedule around your life'],
        ].map(([icon, title, desc]) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">
            <span style="font-size:16px;flex-shrink:0">${icon}</span>
            <div>
              <div style="font-size:12px;font-weight:700;color:#ffffff;margin-bottom:2px">${title}</div>
              <div style="font-size:11px;color:#8888aa;line-height:1.4">${desc}</div>
            </div>
          </div>`).join('')}
      </div>

      <!-- CTA Button -->
      <a href="${loginLink}"
        style="display:block;background:linear-gradient(135deg,#4ecca3,#3da88a);color:#0d0d1a;text-align:center;padding:16px 24px;border-radius:12px;font-weight:900;font-size:14px;text-decoration:none;text-transform:uppercase;letter-spacing:.5px;margin-bottom:24px">
        Access Execution OS Now →
      </a>

      <!-- Personal note -->
      <div style="background:rgba(255,217,61,.06);border:1px solid rgba(255,217,61,.15);border-radius:10px;padding:14px 18px;margin-bottom:24px">
        <p style="font-size:12px;color:#d4d4e8;line-height:1.7;margin:0">
          <strong style="color:#ffd93d">One thing from me personally:</strong> The people who get results fastest are the ones who open the app today, fill in their Revenue Plan and Ideal Customer section, and start executing from Day 1. Don't wait for the perfect moment. Start now.
        </p>
      </div>

      <!-- Signature -->
      <p style="font-size:13px;color:#8888aa;margin:0;line-height:1.6">
        Any questions? Just reply to this email — I read every one.<br>
        <strong style="color:#d4d4e8">— Evan</strong><br>
        <span style="font-size:11px;color:#55557a">Execution OS · build.skillslibry.com</span>
      </p>

    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px;font-size:10px;color:#55557a;line-height:1.6">
      You received this because your access was manually activated by Evan.<br>
      © Execution OS · build.skillslibry.com
    </div>

  </div>
</body>
</html>
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Evan — Execution OS <evan@build.skillslibry.com>',
        to: email,
        subject: `You're in, ${firstName} 🔑 — Your Execution OS Access is Ready`,
        html: emailHtml,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data.message || 'Failed to send email' });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
