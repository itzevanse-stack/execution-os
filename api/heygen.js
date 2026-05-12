// api/heygen.js — HeyGen video generation backend
// Server-side only — API key never exposed to browser

const HEYGEN_BASE = 'https://api.heygen.com';

module.exports = async function handler(req, res) {
  // Always return JSON — never let errors return HTML
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
  const KEY = process.env.HEYGEN_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'HEYGEN_API_KEY not set in Vercel environment variables.' });

  const { action } = req.body || {};

  const heygenGet  = (path) => fetch(`${HEYGEN_BASE}${path}`, { headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' } });
  const heygenPost = (path, body) => fetch(`${HEYGEN_BASE}${path}`, { method: 'POST', headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) });

  // ── LIST STOCK AVATARS ─────────────────────────────────────────────────────
  if (action === 'get-avatars') {
    try {
      const r = await heygenGet('/v2/avatars');
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.message || 'Failed to fetch avatars' });
      const avatars = (d.data?.avatars || []).map(a => ({
        avatar_id:         a.avatar_id,
        avatar_name:       a.avatar_name,
        preview_image_url: a.preview_image_url || '',
        default_voice_id:  a.default_voice?.voice_id || '',
        gender:            a.gender || '',
        type:              'stock',
      }));
      return res.status(200).json({ avatars });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CREATE PHOTO AVATAR (photo → talking avatar) ───────────────────────────
  // User uploads a photo, HeyGen creates an avatar from it
  if (action === 'create-photo-avatar') {
    const { imageData, imageName, mimeType, avatarName } = req.body || {};
    if (!imageData) return res.status(400).json({ error: 'Missing image data' });

    try {
      const buffer = Buffer.from(imageData, 'base64');

      // Use Node.js built-in FormData (Node 18+) or fall back to form-data package
      let FormDataClass;
      try {
        // Node 18+ has built-in FormData
        FormDataClass = globalThis.FormData || require('form-data');
      } catch(e) {
        FormDataClass = require('form-data');
      }

      const form = new FormDataClass();
      const isNativeFormData = typeof globalThis.FormData !== 'undefined' && FormDataClass === globalThis.FormData;

      if (isNativeFormData) {
        // Native FormData (Node 18+) — use Blob
        const { Blob } = require('buffer');
        const blob = new Blob([buffer], { type: mimeType || 'image/jpeg' });
        form.append('file', blob, imageName || 'avatar.jpg');
        form.append('type', 'image');
        const uploadResp = await fetch(`${HEYGEN_BASE}/v1/asset`, {
          method: 'POST',
          headers: { 'X-Api-Key': KEY },
          body: form,
        });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return res.status(uploadResp.status).json({ error: uploadData.message || 'Image upload failed' });
        const imageUrl = uploadData.data?.url || uploadData.url;
        if (!imageUrl) return res.status(500).json({ error: 'No image URL returned' });
        const createResp = await heygenPost('/v2/photo_avatar', { image_url: imageUrl, name: avatarName || 'My Avatar' });
        const createData = await createResp.json();
        if (!createResp.ok) return res.status(createResp.status).json({ error: createData.message || 'Photo avatar creation failed' });
        const photoAvatarId = createData.data?.photo_avatar_id || createData.photo_avatar_id;
        return res.status(200).json({ success: true, photoAvatarId, imageUrl, status: 'ready' });
      } else {
        // form-data package
        form.append('file', buffer, { filename: imageName || 'avatar.jpg', contentType: mimeType || 'image/jpeg' });
        form.append('type', 'image');
        const uploadResp = await fetch(`${HEYGEN_BASE}/v1/asset`, {
          method: 'POST',
          headers: { 'X-Api-Key': KEY, ...form.getHeaders() },
          body: form,
        });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) return res.status(uploadResp.status).json({ error: uploadData.message || 'Image upload failed' });
        const imageUrl = uploadData.data?.url || uploadData.url;
        if (!imageUrl) return res.status(500).json({ error: 'No image URL returned' });
        const createResp = await heygenPost('/v2/photo_avatar', { image_url: imageUrl, name: avatarName || 'My Avatar' });
        const createData = await createResp.json();
        if (!createResp.ok) return res.status(createResp.status).json({ error: createData.message || 'Photo avatar creation failed' });
        const photoAvatarId = createData.data?.photo_avatar_id || createData.photo_avatar_id;
        return res.status(200).json({ success: true, photoAvatarId, imageUrl, status: 'ready' });
      }
    } catch(e) {
      console.error('Photo avatar error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GENERATE VIDEO ─────────────────────────────────────────────────────────
  if (action === 'generate') {
    const { script, avatarId, photoAvatarId, type } = req.body || {};
    if (!script) return res.status(400).json({ error: 'Missing script' });

    try {
      let character;
      let finalVoiceId = null;

      if (photoAvatarId) {
        // Generate using a photo avatar (talking photo)
        character = {
          type:            'talking_photo',
          talking_photo_id: photoAvatarId,
        };
      } else {
        // Use stock or personal video avatar
        let finalAvatarId = avatarId;
        if (!finalAvatarId) {
          // Fetch available avatars and use the first one
          const avR = await heygenGet('/v2/avatars');
          const avD = await avR.json();
          const first = (avD.data?.avatars || [])[0];
          if (!first) return res.status(400).json({ error: 'No avatars available in your HeyGen account.' });
          finalAvatarId = first.avatar_id;
          finalVoiceId  = first.default_voice?.voice_id || null;
        }
        character = {
          type:         'avatar',
          avatar_id:    finalAvatarId,
          avatar_style: 'normal',
        };
      }

      // Get a voice if we don't have one yet
      if (!finalVoiceId) {
        const vR = await heygenGet('/v2/voices');
        const vD = await vR.json();
        const voices = vD.data?.voices || [];
        const v = voices.find(v => v.language === 'English' && v.gender === 'male')
               || voices.find(v => v.language === 'English')
               || voices[0];
        if (v) finalVoiceId = v.voice_id;
      }

      if (!finalVoiceId && !photoAvatarId) {
        return res.status(400).json({ error: 'No voice available.' });
      }

      const isVertical = type === 'reel' || type === 'shorts' || type === 'story';
      const dimension  = isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

      const videoInput = {
        character,
        background: { type: 'color', value: '#1a1a2e' },
      };

      if (finalVoiceId) {
        videoInput.voice = {
          type:       'text',
          input_text: script.trim().substring(0, 1500),
          voice_id:   finalVoiceId,
          speed:      1.0,
        };
      } else {
        videoInput.voice = {
          type:       'text',
          input_text: script.trim().substring(0, 1500),
          voice_id:   '', // HeyGen will auto-pick
          speed:      1.0,
        };
      }

      const resp = await heygenPost('/v2/video/generate', {
        video_inputs: [videoInput],
        dimension,
        test: false,
      });

      const data = await resp.json();
      if (!resp.ok) {
        console.error('HeyGen generate error:', JSON.stringify(data));
        return res.status(resp.status).json({ error: data.message || data.error || JSON.stringify(data) });
      }

      return res.status(200).json({
        videoId:  data.data?.video_id || data.video_id,
        status:   'processing',
      });
    } catch(e) {
      console.error('Generate exception:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── CHECK VIDEO STATUS ─────────────────────────────────────────────────────
  if (action === 'status') {
    const { videoId } = req.body || {};
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });
    try {
      const r = await heygenGet(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
      const d = await r.json();
      const info = d.data || {};
      return res.status(200).json({
        status:   info.status    || 'processing',
        videoUrl: info.video_url || null,
        error:    info.error     || null,
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GET SUPPORTED TRANSLATION LANGUAGES ───────────────────────────────────
  if (action === 'get-languages') {
    try {
      const r = await heygenGet('/v2/video_translate/target_languages');
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.message || 'Failed' });
      return res.status(200).json({ languages: d.data || [] });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── TRANSLATE VIDEO ────────────────────────────────────────────────────────
  if (action === 'translate') {
    const { videoUrl, language } = req.body || {};
    if (!videoUrl || !language) return res.status(400).json({ error: 'Missing videoUrl or language' });
    try {
      const r = await heygenPost('/v2/video_translate', { video_url: videoUrl, output_language: language });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.message || 'Translation failed' });
      return res.status(200).json({ success: true, videoTranslateId: d.data?.video_translate_id || d.video_translate_id });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CHECK TRANSLATION STATUS ───────────────────────────────────────────────
  if (action === 'translation-status') {
    const { videoTranslateId } = req.body || {};
    if (!videoTranslateId) return res.status(400).json({ error: 'Missing videoTranslateId' });
    try {
      const r = await heygenGet(`/v1/video_translate/${encodeURIComponent(videoTranslateId)}`);
      const d = await r.json();
      return res.status(200).json({ status: d.data?.status || d.status, videoUrl: d.data?.video_url || null });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── CHECK AVATAR STATUS ─────────────────────────────────────────────────────
  if (action === 'avatar-status') {
    const { avatarId } = req.body || {};
    if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });
    try {
      const r = await heygenGet(`/v2/photo_avatar/${encodeURIComponent(avatarId)}`);
      const d = await r.json();
      const info = d.data || {};
      return res.status(200).json({
        status: info.status || info.train_status || 'processing',
        name:   info.name   || '',
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch(globalErr) {
    console.error('HeyGen handler crash:', globalErr.message);
    return res.status(500).json({ error: 'Server error: ' + globalErr.message });
  }
};
