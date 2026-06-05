/**
 * POST /api/tts
 * Converts text to speech using ElevenLabs API.
 * Returns audio as base64 so frontend can play it directly.
 * 
 * Body: { text: string, voiceId?: string }
 */

'use strict';

const ELEVENLABS_API  = 'https://api.elevenlabs.io/v1';
const API_KEY         = process.env.ELEVENLABS_API_KEY;

// Default voice: "Adam" — deep, authoritative, strategic advisor feel
// Full list at elevenlabs.io/app/voice-lab
const DEFAULT_VOICE   = 'pNInz6obpgDQGcFmaJgB'; // Adam

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured in environment variables.' });
  }

  const { text, voiceId } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  // Cap at 5000 chars to stay within ElevenLabs limits per request
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
        model_id: 'eleven_turbo_v2_5', // fastest + best quality balance
        voice_settings: {
          stability:        0.45,  // slight variation = more natural
          similarity_boost: 0.82,  // high similarity to voice profile
          style:            0.35,  // some expressiveness
          use_speaker_boost: true, // cleaner audio
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[tts] ElevenLabs error:', response.status, errText);
      return res.status(response.status).json({
        error: 'ElevenLabs error: ' + response.status + ' — ' + errText.slice(0, 200),
      });
    }

    // Convert audio buffer to base64 and send to client
    const audioBuffer = await response.arrayBuffer();
    const base64Audio  = Buffer.from(audioBuffer).toString('base64');

    return res.status(200).json({
      ok:        true,
      audio:     base64Audio,
      mimeType:  'audio/mpeg',
    });

  } catch (err) {
    console.error('[tts] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
