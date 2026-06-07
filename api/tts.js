/**
 * POST /api/tts
 * Text-to-speech via OpenAI TTS API.
 * Returns audio as base64 MP3.
 * 
 * OpenAI TTS: $0.015 per 1,000 characters — no monthly quota.
 * Voice: onyx — deep, authoritative, strategist feel.
 * 
 * Body: { text: string }
 */

'use strict';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE          = 'onyx';   // deep, authoritative — best for strategic coaching
const MODEL          = 'tts-1';  // tts-1 = fastest, tts-1-hd = highest quality

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured in Vercel environment variables.' });
  }

  const { text, voiceId } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided.' });
  }

  // Cap at 4096 chars — OpenAI TTS limit per request
  const safeText = text.slice(0, 4096);
  const voice    = voiceId || VOICE;

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        voice: voice,
        input: safeText,
        response_format: 'mp3',
        speed: 0.95, // slightly slower than default — easier to absorb
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[tts] OpenAI error:', response.status, errText.slice(0, 200));
      return res.status(response.status).json({
        error: 'TTS error ' + response.status + ': ' + errText.slice(0, 150),
      });
    }

    // Convert audio buffer to base64
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

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
