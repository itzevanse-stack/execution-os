// api/unsubscribe.js — handles one-click unsubscribe and list-unsubscribe header
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { e, from } = req.method === 'POST' ? (req.body || {}) : (req.query || {});

  let email = '';
  try {
    if (e) email = Buffer.from(e, 'base64').toString('utf-8');
  } catch(err) { email = ''; }

  // Save to Firestore unsubscribe list
  if (email && email.includes('@')) {
    try {
      const { initializeApp, getApps, cert } = require('firebase-admin/app');
      const { getFirestore }                  = require('firebase-admin/firestore');
      if (!getApps().length) {
        initializeApp({ credential: cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        })});
      }
      const db = getFirestore();
      await db.collection('unsubscribes').doc(email.toLowerCase()).set({
        email:       email.toLowerCase(),
        unsubFrom:   from || '',
        unsubscribedAt: new Date().toISOString(),
      });
    } catch(err) {
      console.error('Unsubscribe save error:', err.message);
    }
  }

  // Return a clean confirmation page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; color: #111; margin-bottom: 10px; }
    p { font-size: 14px; color: #777; line-height: 1.7; }
    .email { font-weight: 700; color: #333; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>You have been unsubscribed</h1>
    <p>
      ${email ? `<span class="email">${email}</span> has been removed from this mailing list.` : 'You have been successfully unsubscribed.'}
      <br><br>
      You will no longer receive marketing emails from this sender.
    </p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
