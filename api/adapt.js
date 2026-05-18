import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getDB() {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase env vars missing');
  const app = getApps().length ? getApp() : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore(app);
}

function sendError(res, message, status = 500) {
  console.error('[api/adapt]', message);
  return res.status(status).json({ ok: false, error: message });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, checkin } = req.body || {};
  if (!userId || !checkin) return sendError(res, 'userId and checkin required', 400);

  let db;
  try { db = getDB(); } catch (err) { return sendError(res, 'Firebase init failed: ' + err.message); }

  try {
    const ref     = db.collection('eos_users').doc(userId);
    const userDoc = await ref.get();

    if (!userDoc.exists) return sendError(res, 'User not found — run the Boardroom first', 404);
    const memory = userDoc.data();
    if (!memory.currentPlan) return sendError(res, 'No plan found — complete the Boardroom first', 404);

    // Load last 3 check-ins for pattern detection
    const checkinDocs = await ref.collection('weekly_checkins')
      .orderBy('timestamp', 'desc').limit(3).get();
    const history = checkinDocs.docs.map(d => d.data()).reverse();

    const plan         = memory.currentPlan;
    const inputs       = plan._inputs || {};
    const week         = memory.currentWeek || 1;
    const weeklyTarget = Math.ceil((inputs.salesNeeded || 5) / 4);
    const ratio        = (checkin.salesMade || 0) / weeklyTarget;
    const onTrack      = ratio >= 0.75;

    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are the adaptive intelligence of Execution-OS — a 9-Figure Digital Product Mentor. You analyze weekly results against the plan and produce a precise, personalised adaptation. You respond to specific numbers and specific obstacles. CRITICAL: Return ONLY valid JSON. No markdown, no preamble.`,
      messages: [{
        role: 'user',
        content: `ORIGINAL PLAN:
Offer: ${inputs.offerName || 'Your offer'} at $${inputs.price || '?'}
Monthly target: $${inputs.target || '?'} | Sales needed: ${inputs.salesNeeded || '?'} total / ${weeklyTarget}/week
Niche: ${inputs.niche || '?'} | Platform: ${plan.primaryChannel || 'not set'}

WEEK ${week} ACTUAL RESULTS:
Sales made: ${checkin.salesMade || 0} (target: ${weeklyTarget})
Conversations started: ${checkin.conversations || 0}
Content posts: ${checkin.contentPosts || 0}
Revenue this week: $${checkin.revenue || 0}
Plan adherence: ${checkin.planAdherence || 0}/100
Biggest win: "${checkin.biggestWin || 'none'}"
Biggest block: "${checkin.biggestBlock || 'none'}"

PRIOR WEEKS (pattern detection):
${history.map((w, i) => `Week ${week - history.length + i}: ${w.salesMade || 0} sales · $${w.revenue || 0} · ${w.planAdherence || 0}% adherence · Block: "${w.biggestBlock || 'none'}"`).join('\n') || 'First week — no prior data'}

Performance: ${onTrack ? 'ON TRACK' : 'BEHIND'} (${Math.round(ratio * 100)}% of weekly target)

Return JSON:
{
  "assessment": "2-3 sentences — honest direct assessment referencing exact numbers",
  "patternDetected": "Recurring pattern across weeks if visible — 1 sentence. null if first week.",
  "adaptedWeekPlan": {
    "title": "Adapted week ${week + 1} theme",
    "focus": "What week ${week + 1} must be about given this week's results",
    "goal": "Adjusted measurable outcome for next week",
    "dailyNonNeg": "ONE daily action that directly addresses their biggest block",
    "actions": ["Action 1 — directly addresses block '${checkin.biggestBlock}'", "Action 2", "Action 3", "Action 4", "Action 5"]
  },
  "criticalAdjustment": "The single most important change they must make right now — 2 sentences, direct and specific",
  "remainingMath": {
    "weeksLeft": ${4 - week},
    "salesStillNeeded": ${(inputs.salesNeeded || 5) - (checkin.salesMade || 0)},
    "revisedWeeklyTarget": "X sales/week for remaining ${4 - week} weeks to still hit monthly goal",
    "stillAchievable": ${ratio >= 0.4 ? 'true' : 'false'}
  },
  "motivationNote": "1-2 sentences — on track: acknowledge specific momentum. Behind: reframe math as still achievable with ONE key change."
}`
      }]
    });

    const raw        = (message.content[0]?.text || '').replace(/```json|```/g, '').trim();
    const adaptation = JSON.parse(raw);

    // Save to Firestore
    await Promise.all([
      ref.collection('weekly_checkins').add({
        week, timestamp: FieldValue.serverTimestamp(),
        salesMade: checkin.salesMade || 0, conversations: checkin.conversations || 0,
        contentPosts: checkin.contentPosts || 0, revenue: checkin.revenue || 0,
        planAdherence: checkin.planAdherence || 0, biggestWin: checkin.biggestWin || '',
        biggestBlock: checkin.biggestBlock || '', adaptation,
      }),
      ref.set({
        lastUpdated:  FieldValue.serverTimestamp(),
        currentWeek:  FieldValue.increment(1),
        totalRevenue: FieldValue.increment(checkin.revenue || 0),
        totalSales:   FieldValue.increment(checkin.salesMade || 0),
        adaptations:  FieldValue.arrayUnion(`Week ${week}: ${adaptation.criticalAdjustment?.slice(0, 80) || 'Adapted'}`),
      }, { merge: true }),
    ]);

    return res.status(200).json({ ok: true, adaptation, week: week + 1, onTrack, performanceRatio: Math.round(ratio * 100) });

  } catch (err) {
    return sendError(res, err.message);
  }
}
