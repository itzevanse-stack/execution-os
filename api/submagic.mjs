// api/submagic.mjs
// Post-processing step for HeyGen (and any other) generated videos.
// Takes a finished video URL, sends it to Submagic's API to add
// professional animated captions, magic zooms, B-roll, silence removal,
// and audio cleanup — the same polish Submagic's own web editor applies,
// now driven entirely from Execution OS.
//
// Built against Submagic's real, published OpenAPI docs (docs.submagic.co),
// not guessed — every field name below is confirmed from their spec.
//
// Gracefully returns a clear "not configured" error if SUBMAGIC_API_KEY is
// unset, so nothing else in the app breaks if this hasn't been set up yet.

const SUBMAGIC_BASE = 'https://api.submagic.co/v1';

function submagicHeaders(key) {
  return {
    'x-api-key': key,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const SUBMAGIC_KEY = process.env.SUBMAGIC_API_KEY;
  if (!SUBMAGIC_KEY) {
    return res.status(200).json({ error: 'submagic_not_configured', message: 'SUBMAGIC_API_KEY is not set in Vercel environment variables.' });
  }

  const { action, videoUrl, title, projectId, options } = req.body || {};

  try {
    // ── Create a new captioning/editing project from a finished video URL ──
    if (action === 'create') {
      if (!videoUrl) return res.status(400).json({ error: 'videoUrl is required' });

      const opts = options || {};
      const payload = {
        title: (title || 'Execution OS Video').slice(0, 100),
        language: opts.language || 'en',
        videoUrl,
        // Sensible professional-polish defaults — matches what the user
        // asked for ("professional animations, captions and great things")
        // without needing them to configure anything themselves.
        magicZooms:            opts.magicZooms            ?? true,
        magicBrolls:           opts.magicBrolls           ?? true,
        magicBrollsPercentage: opts.magicBrollsPercentage ?? 40,
        removeSilencePace:     opts.removeSilencePace     ?? 'natural',
        removeBadTakes:        opts.removeBadTakes        ?? true,
        cleanAudio:            opts.cleanAudio            ?? true,
        // templateName intentionally omitted — Submagic defaults to "Sara"
        // if not specified, which is a clean, professional caption style.
      };
      if (opts.templateName) payload.templateName = opts.templateName;
      if (opts.dictionary && Array.isArray(opts.dictionary)) payload.dictionary = opts.dictionary;

      console.log('[submagic] Creating project. Payload:', JSON.stringify(payload));

      const resp = await fetch(`${SUBMAGIC_BASE}/projects`, {
        method: 'POST',
        headers: submagicHeaders(SUBMAGIC_KEY),
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[submagic] Create FAILED. HTTP', resp.status, '— Full Submagic response:', JSON.stringify(data));
        return res.status(200).json({ error: 'submagic_create_failed', status: resp.status, detail: data });
      }
      console.log('[submagic] Project created OK:', data.id, data.status);
      return res.status(200).json({ projectId: data.id, status: data.status });
    }

    // ── Poll project status until captions/effects are done ────────────────
    if (action === 'status') {
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });

      const resp = await fetch(`${SUBMAGIC_BASE}/projects/${projectId}`, {
        method: 'GET',
        headers: submagicHeaders(SUBMAGIC_KEY),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('[submagic] Status check FAILED. HTTP', resp.status, '— Full Submagic response:', JSON.stringify(data));
        return res.status(200).json({ error: 'submagic_status_failed', status: resp.status, detail: data });
      }

      return res.status(200).json({
        status:        data.status, // processing | transcribing | exporting | completed | failed
        downloadUrl:   data.downloadUrl || '',
        directUrl:     data.directUrl   || '',
        previewUrl:    data.previewUrl  || '',
        failureReason: data.failureReason || '',
      });
    }

    return res.status(400).json({ error: 'Unknown action. Use "create" or "status".' });

  } catch (err) {
    console.error('[submagic] Error:', err.message);
    return res.status(200).json({ error: 'submagic_exception', message: err.message });
  }
}
