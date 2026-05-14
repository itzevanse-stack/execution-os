// api/heygen.js — HeyGen video generation backend
// Correct endpoints per HeyGen API docs v4.0.8

const API  = 'https://api.heygen.com';
const UPLOAD = 'https://upload.heygen.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Always return JSON — wrap everything
  try {

  const KEY = process.env.HEYGEN_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured in Vercel.' });

  const { action } = req.body || {};

  const apiGet  = (path) => fetch(`${API}${path}`, {
    headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' }
  });
  const apiPost = (path, body) => fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });

  // Safe JSON parser — returns { ok, data, error } even if response is HTML
  async function safeJson(resp) {
    const text = await resp.text();
    try {
      return { ok: resp.ok, status: resp.status, data: JSON.parse(text) };
    } catch(e) {
      console.error('Non-JSON response:', text.substring(0, 200));
      return { ok: false, status: resp.status, data: { error: `HeyGen returned non-JSON (${resp.status}): ${text.substring(0,100)}` } };
    }
  }

  // ── GET AVATARS ──────────────────────────────────────────────────────────────
  if (action === 'get-avatars') {
    const r = await apiGet('/v2/avatars');
    const { ok, data } = await safeJson(r);
    if (!ok) return res.status(500).json({ error: data.error || 'Failed to fetch avatars' });
    const avatars = (data.data?.avatars || []).map(a => ({
      avatar_id:         a.avatar_id,
      avatar_name:       a.avatar_name || a.avatar_id,
      preview_image_url: a.preview_image_url || '',
      default_voice_id:  a.default_voice?.voice_id || '',
      gender:            a.gender || '',
    }));
    return res.status(200).json({ avatars });
  }

  // ── CREATE VIDEO AVATAR (Instant Avatar from recorded video) ────────────────
  // Frontend sends action:'create-avatar' for video upload
  if (action === 'create-avatar') {
    const { videoData, fileName, mimeType, uid } = req.body || {};
    if (!videoData) return res.status(400).json({ error: 'Missing video data' });

    const buffer    = Buffer.from(videoData, 'base64');
    const videoType = mimeType || 'video/mp4';

    console.log('Uploading instant avatar video:', buffer.length, 'bytes');

    // Upload video to HeyGen instant avatar endpoint
    const uploadResp = await fetch(`${UPLOAD}/v1/instant_avatar/video/upload`, {
      method:  'POST',
      headers: {
        'X-Api-Key':    KEY,
        'Content-Type': videoType,
        'Accept':       'application/json',
      },
      body: buffer,
    });

    const { ok: upOk, data: upData, status: upStatus } = await safeJson(uploadResp);
    console.log('Instant avatar upload response:', upStatus, JSON.stringify(upData).substring(0, 300));

    if (!upOk) {
      const msg = upData?.message || upData?.error || JSON.stringify(upData).substring(0, 200);
      return res.status(500).json({ error: 'Video upload failed: ' + msg });
    }

    const avatarId = upData.data?.avatar_id || upData.avatar_id || upData.data?.job_id || upData.job_id;
    return res.status(200).json({
      success:  true,
      avatarId: avatarId || 'pending_' + Date.now(),
      jobId:    avatarId,
      status:   'pending',
      message:  'Avatar video submitted. Processing takes 2-5 minutes.',
    });
  }

  // ── CREATE PHOTO AVATAR (talking photo) ─────────────────────────────────────
  // Correct method: raw binary POST — NOT multipart form data
  // curl equivalent: curl -X POST https://upload.heygen.com/v1/talking_photo
  //   -H 'X-Api-Key: KEY' -H 'Content-Type: image/jpeg' --data-binary '@photo.jpg'
  if (action === 'create-photo-avatar') {
    const { imageData, mimeType } = req.body || {};
    if (!imageData) return res.status(400).json({ error: 'Missing image data' });

    const buffer    = Buffer.from(imageData, 'base64');
    const imageType = (mimeType || 'image/jpeg').replace('image/', '') === 'png' ? 'image/png' : 'image/jpeg';

    console.log('Uploading talking photo:', buffer.length, 'bytes,', imageType);

    // Send raw binary — this is what HeyGen expects
    const uploadResp = await fetch(`${UPLOAD}/v1/talking_photo`, {
      method:  'POST',
      headers: {
        'X-Api-Key':    KEY,
        'Content-Type': imageType,
        'Accept':       'application/json',
      },
      body: buffer,
    });

    const { ok: upOk, data: upData, status: upStatus } = await safeJson(uploadResp);
    console.log('Talking photo response:', upStatus, JSON.stringify(upData).substring(0, 300));

    if (!upOk) {
      const msg = upData?.message || upData?.error || upData?.msg || JSON.stringify(upData).substring(0, 200);
      return res.status(500).json({ error: 'Photo upload failed: ' + msg });
    }

    // Response: { code: 100, data: { talking_photo_id: "...", talking_photo_url: "..." } }
    const talkingPhotoId = upData.data?.talking_photo_id || upData.talking_photo_id;
    if (!talkingPhotoId) {
      return res.status(500).json({
        error: 'No talking_photo_id returned. Full response: ' + JSON.stringify(upData).substring(0, 300)
      });
    }

    return res.status(200).json({
      success:        true,
      talkingPhotoId: talkingPhotoId,
      photoUrl:       upData.data?.talking_photo_url || '',
      status:         'ready',
    });
  }

  // ── GET VOICES ────────────────────────────────────────────────────────────────
  if (action === 'get-voices') {
    const r = await safeJson(await apiGet('/v2/voices'));
    const voices = (r.data?.data?.voices || []).map(v => ({
      voice_id:     v.voice_id,
      display_name: v.display_name || v.name || v.voice_id,
      language:     v.language || 'Other',
      gender:       v.gender || '',
      preview_url:  v.preview_audio || '',
    }));
    return res.status(200).json({ voices });
  }

  // ── GENERATE VIDEO ───────────────────────────────────────────────────────────
  if (action === 'generate') {
    const { script, avatarId, talkingPhotoId, photoAvatarId, type } = req.body || {};
    if (!script) return res.status(400).json({ error: 'Missing script' });

    // Use voice from frontend if provided, otherwise auto-pick
    let voiceId = req.body.voiceId || null;
    if (!voiceId) {
      const vR = await safeJson(await apiGet('/v2/voices'));
      const voices = vR.data?.data?.voices || [];
      const voice  = voices.find(v => v.language === 'English' && v.gender === 'male')
                  || voices.find(v => v.language === 'English')
                  || voices[0];
      if (voice) voiceId = voice.voice_id;
    }

    let character;
    const resolvedPhotoId = talkingPhotoId || photoAvatarId;

    if (resolvedPhotoId) {
      // Talking photo video
      character = { type: 'talking_photo', talking_photo_id: resolvedPhotoId };
    } else {
      // Avatar video — get first available if none specified
      let finalId = avatarId;
      if (!finalId) {
        const avR = await safeJson(await apiGet('/v2/avatars'));
        const first = (avR.data?.data?.avatars || [])[0];
        if (!first) return res.status(400).json({ error: 'No avatars in your HeyGen account.' });
        finalId = first.avatar_id;
        if (first.default_voice?.voice_id) voiceId = first.default_voice.voice_id;
      }
      character = { type: 'avatar', avatar_id: finalId, avatar_style: 'normal' };
    }

    if (!voiceId) return res.status(400).json({ error: 'No voice available in your HeyGen account.' });

    const isVertical = ['reel','shorts','story'].includes(type);
    const dimension  = isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

    const payload = {
      video_inputs: [{
        character,
        voice: {
          type:       'text',
          input_text: script.trim().substring(0, 1500),
          voice_id:   voiceId,
          speed:      1.0,
        },
        background: { type: 'color', value: '#1a1a2e' },
      }],
      dimension,
      test: false,
      // title helps identify in HeyGen dashboard
      title: 'Execution OS Video - ' + new Date().toISOString().split('T')[0],
    };

    const r = await safeJson(await apiPost('/v2/video/generate', payload));
    if (!r.ok) {
      return res.status(500).json({ error: r.data?.message || r.data?.error || JSON.stringify(r.data) });
    }

    return res.status(200).json({
      videoId: r.data?.data?.video_id || r.data?.video_id,
      status:  'processing',
    });
  }

  // ── CHECK VIDEO STATUS ────────────────────────────────────────────────────────
  // Use v2 endpoint for videos generated via v2/video/generate
  if (action === 'status') {
    const { videoId } = req.body || {};
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

    // Try v2 endpoint first (correct for v2/video/generate)
    const r2 = await safeJson(await apiGet(`/v2/videos/${encodeURIComponent(videoId)}`));
    if (r2.ok && r2.data?.data) {
      const info = r2.data.data;
      return res.status(200).json({
        status:   info.status    || 'processing',
        videoUrl: info.video_url || null,
        error:    info.error     || null,
      });
    }

    // Fall back to v1 endpoint (for older generated videos)
    const r1 = await safeJson(await apiGet(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`));
    const info = r1.data?.data || {};
    return res.status(200).json({
      status:   info.status    || 'processing',
      videoUrl: info.video_url || null,
      error:    info.error     || null,
    });
  }

  // ── GET TRANSLATION LANGUAGES ─────────────────────────────────────────────────
  if (action === 'get-languages') {
    const r = await safeJson(await apiGet('/v2/video_translate/target_languages'));
    return res.status(200).json({ languages: r.data?.data || [] });
  }

  // ── TRANSLATE VIDEO ───────────────────────────────────────────────────────────
  if (action === 'translate') {
    const { videoUrl, language } = req.body || {};
    if (!videoUrl || !language) return res.status(400).json({ error: 'Missing videoUrl or language' });
    const r = await safeJson(await apiPost('/v2/video_translate', { video_url: videoUrl, output_language: language }));
    if (!r.ok) return res.status(500).json({ error: r.data?.message || 'Translation failed' });
    return res.status(200).json({ success: true, videoTranslateId: r.data?.data?.video_translate_id });
  }

  // ── CHECK TRANSLATION STATUS ──────────────────────────────────────────────────
  if (action === 'translation-status') {
    const { videoTranslateId } = req.body || {};
    if (!videoTranslateId) return res.status(400).json({ error: 'Missing videoTranslateId' });
    const r = await safeJson(await apiGet(`/v1/video_translate/${encodeURIComponent(videoTranslateId)}`));
    return res.status(200).json({ status: r.data?.data?.status, videoUrl: r.data?.data?.video_url || null });
  }

  // ── CHECK AVATAR STATUS ───────────────────────────────────────────────────────
  if (action === 'avatar-status') {
    const { avatarId } = req.body || {};
    if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });
    const r = await safeJson(await apiGet(`/v2/photo_avatar/${encodeURIComponent(avatarId)}`));
    return res.status(200).json({ status: r.data?.data?.status || 'processing' });
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch(e) {
    console.error('heygen.js crash:', e.message);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
