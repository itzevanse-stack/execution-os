// api/memory.js — Execution-OS Persistent Memory System
// Saves boardroom intel, run history, and performance data to Firebase
// Loads previous intel to power AI improvements over time

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

// ── LangSmith tracing ──────────────────────────────────────────────────────
if (process.env.LANGCHAIN_API_KEY) {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_PROJECT    = process.env.LANGCHAIN_PROJECT || 'execution-os-boardroom';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { action, uid, data } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });
  if (!uid)    return res.status(400).json({ error: 'Missing uid' });

  const db  = getDb();
  const ref = db.collection('users').doc(uid);

  // ══════════════════════════════════════════════════════════════════════════
  // SAVE — store boardroom intel + add to history
  // ══════════════════════════════════════════════════════════════════════════
  if (action === 'save-boardroom') {
    const intel   = data.intel   || {};
    const inputs  = intel.inputs || {};
    const now     = Date.now();

    // ── Build the memory snapshot ────────────────────────────────────────
    const snapshot = {
      savedAt:       now,
      niche:         inputs.niche         || '',
      price:         inputs.price         || 0,
      target:        inputs.target        || 0,
      offerName:     inputs.offerName     || '',
      isAffiliate:   inputs.isAffiliate   || false,

      // Compressed intel — key insights only (not full JSON to save storage)
      positioningStatement: (intel.architect || {}).positioningStatement || '',
      categoryName:         (intel.architect || {}).categoryName         || '',
      dominanceAngle:       (intel.architect || {}).dominanceAngle       || '',
      immediateWin:         (intel.architect || {}).immediateWin         || '',
      offerName_rebuilt:    (intel.offerStack || {}).rebuiltName         || '',
      topHeadline:          ((intel.copyVault || {}).headlines || [])[0] || '',
      topHook:              ((intel.copyVault || {}).hooks || [])[0]     || '',
      warPlanGoal:          ((intel.warPlan || {}).phase1 || {}).goal    || '',
      contentPillars:       ((intel.contentEngine || {}).pillars || []),

      // Scores
      tabScores:     data.tabScores || {},
      tabCount:      Object.keys(data.tabScores || {}).filter(k => (data.tabScores[k] || 0) > 30).length,
    };

    try {
      // ── 1. Save current intel to user doc (overwrite) ──────────────────
      await ref.update({
        boardroomIntel:         intel,
        boardroomLastRun:       now,
        boardroomRunCount:      FieldValue.increment(1),
        boardroomLastNiche:     inputs.niche || '',
        boardroomLastOfferName: inputs.offerName || '',
        updatedAt:              now,
      });

      // ── 2. Add snapshot to history subcollection ───────────────────────
      await ref.collection('boardroom-history')
        .doc(String(now))
        .set(snapshot);

      // ── 3. Update execution memory (AI context for next run) ───────────
      await ref.update({
        executionMemory: {
          lastRun:           now,
          runsTotal:         FieldValue.increment(1),
          lastNiche:         inputs.niche     || '',
          lastOffer:         inputs.offerName || '',
          lastPrice:         inputs.price     || 0,
          lastTarget:        inputs.target    || 0,
          lastPositioning:   snapshot.positioningStatement,
          lastCategory:      snapshot.categoryName,
          lastImmediateWin:  snapshot.immediateWin,
        },
      });

      console.log('[Memory] Saved boardroom run for uid:', uid, '| niche:', inputs.niche);
      return res.status(200).json({ success: true, savedAt: now });

    } catch(err) {
      console.error('[Memory] Save failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOAD — get current intel + history for AI context
  // ══════════════════════════════════════════════════════════════════════════
  if (action === 'load-boardroom') {
    try {
      const userSnap = await ref.get();
      if (!userSnap.exists()) {
        return res.status(200).json({ found: false });
      }

      const userData = userSnap.data();
      const intel    = userData.boardroomIntel || null;
      const memory   = userData.executionMemory || {};

      // Load last 5 run snapshots for AI context
      const historySnap = await ref.collection('boardroom-history')
        .orderBy('savedAt', 'desc')
        .limit(5)
        .get();

      const history = historySnap.docs.map(d => d.data());

      // Build AI memory context string (injected into next Boardroom run)
      let memoryContext = '';
      if (history.length > 1) {
        memoryContext = [
          'EXECUTION MEMORY — This user has run The Boardroom ' + (userData.boardroomRunCount || history.length) + ' times.',
          'Previous runs:',
          ...history.slice(0, 3).map((h, i) =>
            '  Run ' + (i+1) + ': ' + h.niche + ' | Offer: ' + (h.offerName || 'unnamed') + ' | Positioning: "' + (h.positioningStatement || '').slice(0, 80) + '"'
          ),
          '',
          'Latest positioning: "' + (memory.lastPositioning || '') + '"',
          'Category they own: "' + (memory.lastCategory || '') + '"',
          'Use this history to give MORE SPECIFIC advice — reference what they built before.',
          'If they changed niche or offer, acknowledge the change and explain what to keep.',
        ].join('\n');
      }

      return res.status(200).json({
        found:         !!intel,
        intel,
        memory,
        history:       history.slice(0, 5),
        memoryContext,
        runCount:      userData.boardroomRunCount || 0,
      });

    } catch(err) {
      console.error('[Memory] Load failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAVE KPIs — store performance metrics
  // ══════════════════════════════════════════════════════════════════════════
  if (action === 'save-kpis') {
    const kpis = data.kpis || {};
    const now  = Date.now();

    try {
      await ref.update({ kpis, kpisUpdatedAt: now });

      // Add to KPI history
      await ref.collection('kpi-history')
        .doc(String(now))
        .set({ ...kpis, recordedAt: now });

      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOAD FULL MEMORY — for Execution Engine context
  // ══════════════════════════════════════════════════════════════════════════
  if (action === 'load-full-memory') {
    try {
      const userSnap = await ref.get();
      if (!userSnap.exists()) return res.status(200).json({ found: false });

      const d = userSnap.data();

      // KPI history — last 4 weeks
      const kpiSnap = await ref.collection('kpi-history')
        .orderBy('recordedAt', 'desc')
        .limit(4)
        .get();

      // Boardroom history — last 3 runs
      const brSnap = await ref.collection('boardroom-history')
        .orderBy('savedAt', 'desc')
        .limit(3)
        .get();

      return res.status(200).json({
        found:           true,
        profile: {
          niche:         d.niche         || d.boardroomLastNiche || '',
          appMode:       d.appMode       || 'expert',
          offerName:     d.boardroomLastOfferName || '',
          revenuePlan:   d.revenuePlan   || {},
          avatarData:    d.avatarData    || {},
          voiceProfile:  d.voiceProfile  || {},
        },
        boardroomIntel:  d.boardroomIntel    || null,
        executionMemory: d.executionMemory   || {},
        kpis:            d.kpis              || {},
        kpiHistory:      kpiSnap.docs.map(doc => doc.data()),
        boardroomHistory: brSnap.docs.map(doc => doc.data()),
        runCount:        d.boardroomRunCount || 0,
      });

    } catch(err) {
      console.error('[Memory] Load full memory failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
};
