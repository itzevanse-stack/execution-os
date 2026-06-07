/**
 * POST /api/tts
 * Text-to-speech with automatic fallback.
 *
 * Primary:  ElevenLabs (Adam voice) — best quality
 * Fallback: OpenAI TTS (onyx voice) — kicks in automatically if ElevenLabs
 *           returns quota_exceeded, 401, or 429
 *
 * Both keys are scoped only to this file — neither touches any other API route.
 * Body: { text: string, voiceId?: string }
 */

'use strict';

const ELEVENLABS_API  = 'https://api.elevenlabs.io/v1';
const OPENAI_API      = 'https://api.openai.com/v1/audio/speech';

const EL_KEY          = process.env.ELEVENLABS_API_KEY;
const OA_KEY          = process.env.OPENAI_API_KEY;

const EL_VOICE        = 'pNInz6obpgDQGcFmaJgB'; // Adam — deep, authoritative
const OA_VOICE        = 'onyx';                  // OpenAI equivalent

// Errors from ElevenLabs that should trigger fallback to OpenAI
const FALLBACK_CODES  = ['quota_exceeded', 'invalid_api_key', 'rate_limit_exceeded'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voiceId } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  const safeText = text.slice(0, 4096);

  // ── Try ElevenLabs first ─────────────────────────────────────────
  if (EL_KEY) {
    try {
      const elResp = await fetch(
        `${ELEVENLABS_API}/text-to-speech/${voiceId || EL_VOICE}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key':   EL_KEY,
            'Content-Type': 'application/json',
            'Accept':       'audio/mpeg',
          },
          body: JSON.stringify({
            text: safeText,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability:         0.45,
              similarity_boost:  0.82,
              style:             0.35,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (elResp.ok) {
        const buf    = await elResp.arrayBuffer();
        const b64    = Buffer.from(buf).toString('base64');
        return res.status(200).json({ ok: true, audio: b64, mimeType: 'audio/mpeg', source: 'elevenlabs' });
      }

      // Check if we should fall back
      const errText = await elResp.text();
      const shouldFallback = elResp.status === 401
        || elResp.status === 429
        || FALLBACK_CODES.some(function(code) { return errText.includes(code); });

      if (!shouldFallback) {
        // A real error — don't try OpenAI, just return the error
        console.error('[tts] ElevenLabs error:', elResp.status, errText.slice(0, 150));
        return res.status(elResp.status).json({ error: 'TTS error: ' + errText.slice(0, 100) });
      }

      console.warn('[tts] ElevenLabs quota/auth issue — falling back to OpenAI. Code:', elResp.status);

    } catch (elErr) {
      console.warn('[tts] ElevenLabs request failed:', elErr.message, '— trying OpenAI');
    }
  }

  // ── Fallback: OpenAI TTS ─────────────────────────────────────────
  if (!OA_KEY) {
    return res.status(500).json({
      error: 'ElevenLabs quota exceeded and OPENAI_API_KEY is not configured. Please top up your ElevenLabs credits or add an OpenAI API key.',
    });
  }

  try {
    const oaResp = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OA_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:           'tts-1',
        voice:           OA_VOICE,
        input:           safeText,
        response_format: 'mp3',
        speed:           0.95,
      }),
    });

    if (!oaResp.ok) {
      const errText = await oaResp.text();
      console.error('[tts] OpenAI fallback error:', oaResp.status, errText.slice(0, 150));
      return res.status(oaResp.status).json({ error: 'TTS fallback error: ' + errText.slice(0, 100) });
    }

    const buf = await oaResp.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');

    console.log('[tts] Served via OpenAI fallback');
    return res.status(200).json({ ok: true, audio: b64, mimeType: 'audio/mpeg', source: 'openai' });

  } catch (oaErr) {
    console.error('[tts] OpenAI fallback failed:', oaErr.message);
    return res.status(500).json({ error: 'Both TTS providers failed. ' + oaErr.message });
  }
};
