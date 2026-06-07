/**
 * POST /api/tts
 * Text-to-speech via ElevenLabs API.
 * Returns audio as base64 MP3.
 *
 * Voice: Adam (pNInz6obpgDQGcFmaJgB) — deep, authoritative, strategic advisor feel.
 * Model: eleven_turbo_v2_5 — fastest with best quality balance.
 *
 * Body: { text: string, voiceId?: string }
 */

'use strict';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const API_KEY        = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE  = 'pNInz6obpgDQGcFmaJgB'; // Adam

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured in Vercel environment variables.' });
  }

  const { text, voiceId } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  const safeText = text.slice(0, 5000);
  const voice    = voiceId || DEFAULT_VOICE;

  try {
    const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key':   API_KEY,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text: safeText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability:        0.45,
          similarity_boost: 0.82,
          style:            0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[tts] ElevenLabs error:', response.status, errText.slice(0, 200));
      return res.status(response.status).json({
        error: 'ElevenLabs error ' + response.status + ': ' + errText.slice(0, 150),
      });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio  = Buffer.from(audioBuffer).toString('base64');

    return res.status(200).json({
      ok:       true,
      audio:    base64Audio,
      mimeType: 'audio/mpeg',
    });

  } catch (err) {
    console.error('[tts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
