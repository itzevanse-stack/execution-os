// api/heygen.js — HeyGen video generation backend
// Keeps the API key server-side, never exposed to the browser

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
  if (!HEYGEN_API_KEY) return res.status(500).json({ error: 'HeyGen API key not configured. Add HEYGEN_API_KEY to Vercel environment variables.' });

  const { action, script, avatarId, type, videoId } = req.body || {};

  // ── GENERATE VIDEO ────────────────────────────────────────────────────────
  if (action === 'generate') {
    if (!script) return res.status(400).json({ error: 'Missing script' });

    // Choose avatar — use provided ID or fall back to a quality stock avatar
    const avatar = avatarId
      ? { avatar_id: avatarId, avatar_type: 'photo' }
      : { avatar_id: 'josh_lite3_20230714', avatar_type: 'photo' }; // Professional stock avatar

    // Voice — use default English voice
    const voice = {
      voice_id: '2d5b0e6cf36f460aa7fc47e3eee4ba54', // English, professional male
      speed:    1.0,
    };

    // Format based on type
    const dimension = type === 'reel'
      ? { width: 1080, height: 1920 } // 9:16 for Reels/TikTok
      : { width: 1920, height: 1080 }; // 16:9 for VSL/YouTube

    try {
      const resp = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST',
        headers: {
          'X-Api-Key':    HEYGEN_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_inputs: [{
            character: {
              type:         'avatar',
              avatar_id:    avatar.avatar_id,
              avatar_style: 'normal',
            },
            voice: {
              type:     'text',
              input_text: script.trim().substring(0, 1500),
              voice_id:   voice.voice_id,
              speed:      voice.speed,
            },
            background: {
              type:  'color',
              value: '#06060f', // Dark background matching Execution OS theme
            },
          }],
          dimension,
          aspect_ratio: type === 'reel' ? '9:16' : '16:9',
          test: false,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        console.error('HeyGen generate error:', data);
        return res.status(resp.status).json({ error: data.message || data.error || 'HeyGen API error' });
      }

      return res.status(200).json({
        videoId: data.data?.video_id || data.video_id,
        status:  'processing',
      });

    } catch(e) {
      console.error('HeyGen generate exception:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── CHECK STATUS ──────────────────────────────────────────────────────────
  if (action === 'status') {
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

    try {
      const resp = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
        headers: { 'X-Api-Key': HEYGEN_API_KEY },
      });

      const data = await resp.json();
      const info = data.data || {};

      return res.status(200).json({
        videoId,
        status:   info.status || 'processing',
        videoUrl: info.video_url || null,
        duration: info.duration || null,
        error:    info.error    || null,
      });

    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── LIST AVATARS (for letting users pick) ─────────────────────────────────
  if (action === 'avatars') {
    try {
      const resp = await fetch('https://api.heygen.com/v2/avatars', {
        headers: { 'X-Api-Key': HEYGEN_API_KEY },
      });
      const data = await resp.json();
      return res.status(200).json({ avatars: data.data?.avatars || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── CREATE AVATAR from uploaded video ────────────────────────────────────────
  if (action === 'create-avatar') {
    const { videoData, fileName, mimeType, uid } = req.body || {};
    if (!videoData) return res.status(400).json({ error: 'Missing video data' });

    try {
      // Convert base64 back to buffer
      const buffer = Buffer.from(videoData, 'base64');

      // Upload video to HeyGen to create Instant Avatar
      const FormData = require('form-data');
      const form = new FormData();
      form.append('video', buffer, { filename: fileName || 'consent.mp4', contentType: mimeType || 'video/mp4' });

      const uploadResp = await fetch('https://api.heygen.com/v2/photo_avatar/video/upload', {
        method: 'POST',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          ...form.getHeaders(),
        },
        body: form,
      });

      const uploadData = await uploadResp.json();

      if (!uploadResp.ok) {
        console.error('HeyGen avatar upload error:', uploadData);
        return res.status(uploadResp.status).json({ error: uploadData.message || 'Avatar upload failed' });
      }

      const avatarId = uploadData.data?.avatar_id || uploadData.avatar_id;
      const jobId    = uploadData.data?.job_id    || uploadData.job_id || avatarId;

      return res.status(200).json({
        success:  true,
        avatarId: avatarId || jobId,
        jobId:    jobId,
        status:   'pending',
        message:  'Avatar creation submitted. Processing takes 24-48 hours.',
      });

    } catch(e) {
      console.error('Create avatar error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
};

// Note: The create-avatar action is appended below the existing handler
// It handles in-app video upload → HeyGen Instant Avatar creation
