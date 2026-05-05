// api/stripe-callback.js — handles Stripe Connect OAuth callback
// Exchanges auth code for account ID, saves to Firestore
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

module.exports = async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(200).send(`
      <html><body style="background:#06060f;color:#ff6b6b;font-family:sans-serif;text-align:center;padding:60px">
        <h2>Connection Cancelled</h2>
        <p>${error}</p>
        <script>window.opener && window.opener.location.reload(); window.close();</script>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;

    // Exchange code for Stripe account ID
    const tokenResp = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_secret: STRIPE_SECRET,
      }).toString()
    });

    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(tokenData.error_description);

    const stripeAccountId = tokenData.stripe_user_id;
    const funnelId = state ? decodeURIComponent(state) : null;

    // Save to Firestore if we have a funnel ID
    // (We'd need the user's UID — for now store globally under the account)
    if (funnelId && funnelId !== 'connect') {
      const db = getDb();
      // Store in a stripe-accounts collection for lookup
      await db.collection('stripe-accounts').doc(stripeAccountId).set({
        stripeAccountId,
        funnelId,
        connectedAt: new Date().toISOString(),
      });
    }

    return res.status(200).send(`
      <html><body style="background:#06060f;color:#4ecca3;font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="font-size:28px;font-weight:900">✅ Stripe Connected!</h2>
        <p style="color:#c8cde8">Your account is ready to accept payments.</p>
        <p style="color:#7a7a9d;font-size:13px">Account ID: ${stripeAccountId}</p>
        <script>
          // Pass account ID back to parent window
          if (window.opener) {
            window.opener.fbShowStripeConnected && window.opener.fbShowStripeConnected('${stripeAccountId}');
          }
          setTimeout(function() { window.close(); }, 1500);
        </script>
      </body></html>
    `);

  } catch (err) {
    console.error('Stripe callback error:', err.message);
    return res.status(200).send(`
      <html><body style="background:#06060f;color:#ff6b6b;font-family:sans-serif;text-align:center;padding:60px">
        <h2>Connection Failed</h2>
        <p>${err.message}</p>
        <script>window.opener && window.opener.location.reload(); window.close();</script>
      </body></html>
    `);
  }
};
