// api/heygen.js — HeyGen full API integration
// Sources: docs.heygen.com (verified May 2026)
// All users share this API key — no per-user HeyGen account needed

const API    = 'https://api.heygen.com';
const UPLOAD = 'https://upload.heygen.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const KEY = process.env.HEYGEN_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'HEYGEN_API_KEY not configured in Vercel.' });

    const { action } = req.body || {};

    // Safe JSON — never return HTML error pages to the client
    async function safeJson(resp) {
      const text = await resp.text();
      try   { return { ok: resp.ok, status: resp.status, data: JSON.parse(text) }; }
      catch (e) {
        console.error(`[HeyGen] Non-JSON [${resp.status}]:`, text.substring(0, 300));
        return { ok: false, status: resp.status, data: { error: `HeyGen [${resp.status}]: ${text.substring(0, 120)}` } };
      }
    }

    const GET  = (path) => fetch(`${API}${path}`, {
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' }
    });
    const POST = (path, body) => fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const DEL  = (path) => fetch(`${API}${path}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' }
    });

    // ══════════════════════════════════════════════════════════════════════
    // LIST AVATARS  —  GET /v2/avatars
    // Returns stock avatars + user's instant avatars (digital twins)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'get-avatars') {
      const r = await safeJson(await GET('/v2/avatars'));
      if (!r.ok) return res.status(500).json({ error: r.data.error || 'Failed to fetch avatars' });
      const avatars = (r.data?.data?.avatars || []).map(a => ({
        avatar_id:         a.avatar_id,
        avatar_name:       a.avatar_name || a.avatar_id,
        preview_image_url: a.preview_image_url || '',
        preview_video_url: a.preview_video_url || '',
        default_voice_id:  a.default_voice?.voice_id || '',
        gender:            a.gender || '',
        type:              a.avatar_type || 'stock',
      }));
      return res.status(200).json({ avatars });
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIST VOICES  —  GET /v2/voices
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'get-voices') {
      const r = await safeJson(await GET('/v2/voices'));
      if (!r.ok) return res.status(500).json({ error: r.data.error || 'Failed to fetch voices' });
      const voices = (r.data?.data?.voices || []).map(v => ({
        voice_id:     v.voice_id,
        display_name: v.display_name || v.name || v.voice_id,
        language:     v.language || 'Other',
        gender:       v.gender || '',
        preview_url:  v.preview_audio || '',
      }));
      return res.status(200).json({ voices });
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIST PHOTO AVATAR GROUPS  —  GET /v2/photo_avatar_group/list
    // Shows user's saved photo avatars — used to reuse without re-uploading
    // Each group has looks; each look has a talking_photo_id for video generation
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'list-avatar-groups') {
      // Correct endpoint per HeyGen docs: /v2/avatar_group.list
      const r = await safeJson(await GET('/v2/avatar_group.list'));
      if (!r.ok) return res.status(500).json({ error: r.data?.error || 'Failed to fetch avatar groups' });
      const groups = r.data?.data?.avatar_group_list || r.data?.data || [];
      return res.status(200).json({ groups });
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIST AVATARS IN GROUP  —  GET /v2/photo_avatar/avatar_group/{group_id}
    // Gets all looks/avatars within a group — each has a unique avatar_id
    // used as talking_photo_id in video generation
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'list-group-avatars') {
      // Correct endpoint: /v2/avatar_group/{group_id}/avatars
      const { groupId } = req.body || {};
      if (!groupId) return res.status(400).json({ error: 'Missing groupId' });
      const r = await safeJson(await GET(`/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`));
      if (!r.ok) return res.status(500).json({ error: r.data?.error || 'Failed to fetch group avatars' });
      return res.status(200).json({ avatars: r.data?.data?.avatar_list || r.data?.data || [] });
    }

    // ══════════════════════════════════════════════════════════════════════
    // DELETE AVATAR GROUP  —  DELETE /v2/photo_avatar_group/{group_id}
    // Removes a photo avatar group and frees up the storage slot
    // Needed when at the 3-group limit
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'delete-avatar-group') {
      const { groupId } = req.body || {};
      if (!groupId) return res.status(400).json({ error: 'Missing groupId' });
      const r = await safeJson(await DEL(`/v2/photo_avatar_group/${encodeURIComponent(groupId)}`));
      return res.status(200).json({ success: r.ok, data: r.data });
    }

    // ══════════════════════════════════════════════════════════════════════
    // UPLOAD PHOTO + CREATE AVATAR GROUP
    // Proper flow per docs.heygen.com/docs/create-and-train-photo-avatar-groups:
    //   1. Upload image as asset  →  get image_key
    //   2. Create avatar group    →  get group_id + talking_photo_id
    //
    // SIMPLE TALKING PHOTO (legacy but still works):
    //   POST https://upload.heygen.com/v1/talking_photo
    //   Raw binary body, Content-Type: image/jpeg
    //   Response: { code: 100, data: { talking_photo_id, talking_photo_url } }
    //
    // NOTE: 3-group limit can be resolved by deleting old groups first
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'create-photo-avatar') {
      const { imageData, mimeType, avatarName } = req.body || {};
      if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

      const buffer    = Buffer.from(imageData, 'base64');
      const imageType = (mimeType && mimeType.includes('png')) ? 'image/png' : 'image/jpeg';

      console.log(`[HeyGen] Uploading talking photo — ${buffer.length} bytes, ${imageType}`);

      // Try simple talking photo endpoint first (fastest, no group needed)
      const uploadResp = await fetch(`${UPLOAD}/v1/talking_photo`, {
        method:  'POST',
        headers: { 'X-Api-Key': KEY, 'Content-Type': imageType, 'Accept': 'application/json' },
        body:    buffer,
      });
      const { ok, data, status } = await safeJson(uploadResp);
      console.log(`[HeyGen] Talking photo [${status}]:`, JSON.stringify(data).substring(0, 200));

      // If at limit, try to auto-delete oldest group and retry
      if (!ok && data?.message && data.message.toLowerCase().includes('limit')) {
        // Get existing groups
        const groupsR = await safeJson(await GET('/v2/photo_avatar_group/list'));
        const groups  = groupsR.data?.data?.avatar_group_list || groupsR.data?.data || [];
        if (groups.length > 0) {
          // Delete the oldest group
          const oldest = groups[groups.length - 1];
          const groupId = oldest.id || oldest.group_id;
          if (groupId) {
            console.log(`[HeyGen] At limit — auto-deleting oldest group: ${groupId}`);
            await DEL(`/v2/photo_avatar_group/${encodeURIComponent(groupId)}`);
            // Retry upload
            const retryResp = await fetch(`${UPLOAD}/v1/talking_photo`, {
              method:  'POST',
              headers: { 'X-Api-Key': KEY, 'Content-Type': imageType, 'Accept': 'application/json' },
              body:    buffer,
            });
            const retry = await safeJson(retryResp);
            if (retry.ok && retry.data?.code === 100) {
              const talkingPhotoId = retry.data.data?.talking_photo_id;
              return res.status(200).json({ success: true, talkingPhotoId, status: 'ready' });
            }
          }
        }
        return res.status(500).json({
          error: 'At photo avatar limit. Please go to heygen.com and delete some old photo avatars, then try again.',
          atLimit: true,
        });
      }

      if (!ok || data.code !== 100) {
        return res.status(500).json({ error: data?.message || data?.msg || data?.error || JSON.stringify(data).substring(0, 200) });
      }

      const talkingPhotoId  = data.data?.talking_photo_id;
      const talkingPhotoUrl = data.data?.talking_photo_url || '';
      if (!talkingPhotoId) {
        return res.status(500).json({ error: 'No talking_photo_id returned: ' + JSON.stringify(data) });
      }
      return res.status(200).json({ success: true, talkingPhotoId, talkingPhotoUrl, status: 'ready' });
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIST EXISTING TALKING PHOTOS  —  GET /v1/talking_photo.list
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'list-talking-photos') {
      // Also returns existing talking photos created via /v1/talking_photo upload
      const r = await safeJson(await GET('/v1/talking_photo.list'));
      if (!r.ok) return res.status(500).json({ error: r.data?.error || 'Failed to list talking photos' });
      const photos = (r.data?.data || []).map(p => ({
        id:        p.id,
        image_url: p.image_url || p.circle_image || '',
      }));
      return res.status(200).json({ photos });
    }

    // ══════════════════════════════════════════════════════════════════════
    // GENERATE AI AVATAR PHOTO — no real photo needed
    // POST /v2/photo_avatar/photo/generate
    // Creates a realistic AI avatar from a text description
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'generate-ai-avatar') {
      const { name, gender, age, ethnicity, orientation, pose, style, appearance } = req.body || {};
      const payload = {
        name:        name        || 'My AI Avatar',
        gender:      gender      || 'Woman',
        age:         age         || 'Young Adult',
        ethnicity:   ethnicity   || 'American',
        orientation: orientation || 'square',
        pose:        pose        || 'half_body',
        style:       style       || 'Realistic',
        appearance:  appearance  || 'Professional person in business casual attire against a clean background',
      };
      const r = await safeJson(await POST('/v2/photo_avatar/photo/generate', payload));
      if (!r.ok) return res.status(500).json({ error: r.data?.message || r.data?.error || 'AI avatar generation failed' });
      return res.status(200).json({ success: true, generationId: r.data?.data?.generation_id });
    }

    // ══════════════════════════════════════════════════════════════════════
    // GENERATE VIDEO  —  POST /v2/video/generate
    // Supports: stock avatars, talking photos, instant avatars (digital twins)
    // Avatar IV supported via use_avatar_iv_model flag
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'generate') {
      const { script, avatarId, talkingPhotoId, voiceId, type, title, useAvatarIV } = req.body || {};
      if (!script) return res.status(400).json({ error: 'Missing script' });

      // Resolve voice
      let finalVoiceId = voiceId || null;
      if (!finalVoiceId) {
        const vR = await safeJson(await GET('/v2/voices'));
        const voices = vR.data?.data?.voices || [];
        const pick = voices.find(v => v.language === 'English' && v.gender === 'male')
                  || voices.find(v => v.language === 'English')
                  || voices[0];
        if (pick) finalVoiceId = pick.voice_id;
      }
      if (!finalVoiceId) return res.status(400).json({ error: 'No voice available. Check your HeyGen account has voices.' });

      // Build character
      let character;
      if (talkingPhotoId) {
        character = { type: 'talking_photo', talking_photo_id: talkingPhotoId };
      } else {
        let finalAvatarId = avatarId;
        if (!finalAvatarId) {
          const avR = await safeJson(await GET('/v2/avatars'));
          const avs  = avR.data?.data?.avatars || [];
          const pick = avs.find(a => !a.is_private) || avs[0];
          if (!pick) return res.status(400).json({ error: 'No avatars in your HeyGen account.' });
          finalAvatarId = pick.avatar_id;
          if (!voiceId && pick.default_voice?.voice_id) finalVoiceId = pick.default_voice.voice_id;
        }
        character = { type: 'avatar', avatar_id: finalAvatarId, avatar_style: 'normal' };
      }

      const vertical  = ['reel', 'shorts', 'story'].includes(type);
      const dimension = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

      const payload = {
        video_inputs: [{
          character,
          voice: {
            type:       'text',
            input_text: script.trim().substring(0, 1500),
            voice_id:   finalVoiceId,
            speed:      1.0,
          },
          background: { type: 'color', value: '#1a1a2e' },
        }],
        dimension,
        caption: false,
        title:   title || ('EOS-' + new Date().toISOString().split('T')[0] + '-' + Date.now().toString().slice(-4)),
      };

      // Use Avatar IV for better quality if requested
      if (useAvatarIV && talkingPhotoId) {
        payload.video_inputs[0].character.use_avatar_iv_model = true;
      }

      console.log('[HeyGen] Generate:', type, character.type, talkingPhotoId || avatarId || 'auto');

      const r = await safeJson(await POST('/v2/video/generate', payload));
      if (!r.ok) {
        return res.status(500).json({ error: r.data?.message || r.data?.error || JSON.stringify(r.data).substring(0, 300) });
      }
      return res.status(200).json({ success: true, videoId: r.data?.data?.video_id || r.data?.video_id });
    }

    // ══════════════════════════════════════════════════════════════════════
    // VIDEO STATUS
    // Primary: GET /v2/videos/{video_id}   — for v2-generated videos
    // Fallback: GET /v1/video_status.get   — for older videos
    // Status: pending | processing | completed | failed
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'status') {
      const { videoId } = req.body || {};
      if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

      const r2 = await safeJson(await GET(`/v2/videos/${encodeURIComponent(videoId)}`));
      if (r2.ok && r2.data?.data) {
        const info = r2.data.data;
        return res.status(200).json({ status: info.status || 'processing', videoUrl: info.video_url || null, error: info.error || null });
      }

      const r1 = await safeJson(await GET(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`));
      const info = r1.data?.data || {};
      return res.status(200).json({ status: info.status || 'processing', videoUrl: info.video_url || null, error: info.error || null });
    }

    // ══════════════════════════════════════════════════════════════════════
    // TRANSLATION LANGUAGES  —  GET /v2/video_translate/target_languages
    // 175+ languages supported
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'get-languages') {
      const r = await safeJson(await GET('/v2/video_translate/target_languages'));
      return res.status(200).json({ languages: r.data?.data || [] });
    }

    // ══════════════════════════════════════════════════════════════════════
    // TRANSLATE VIDEO  —  POST /v2/video_translate
    // mode: 'fast' (default) or 'quality' (better lip-sync, more credits)
    // output_language: full name e.g. "Spanish" not "es"
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'translate') {
      const { videoUrl, language, quality } = req.body || {};
      if (!videoUrl || !language) return res.status(400).json({ error: 'Missing videoUrl or language' });
      const payload = { video_url: videoUrl, output_language: language };
      if (quality === 'quality') payload.mode = 'quality';
      const r = await safeJson(await POST('/v2/video_translate', payload));
      if (!r.ok) return res.status(500).json({ error: r.data?.message || 'Translation failed' });
      return res.status(200).json({ success: true, videoTranslateId: r.data?.data?.video_translate_id });
    }

    // ══════════════════════════════════════════════════════════════════════
    // TRANSLATION STATUS  —  GET /v1/video_translate/{id}
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'translation-status') {
      const { videoTranslateId } = req.body || {};
      if (!videoTranslateId) return res.status(400).json({ error: 'Missing videoTranslateId' });
      const r = await safeJson(await GET(`/v1/video_translate/${encodeURIComponent(videoTranslateId)}`));
      return res.status(200).json({ status: r.data?.data?.status || 'processing', videoUrl: r.data?.data?.video_url || null });
    }

    // ══════════════════════════════════════════════════════════════════════
    // CREATE VIDEO AVATAR (Instant Avatar / Digital Twin)
    // POST https://upload.heygen.com/v1/instant_avatar/video/upload
    // Requires recorded consent video, raw binary body
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'create-avatar') {
      const { videoData, mimeType } = req.body || {};
      if (!videoData) return res.status(400).json({ error: 'Missing videoData' });
      const buffer = Buffer.from(videoData, 'base64');
      console.log(`[HeyGen] Uploading instant avatar — ${buffer.length} bytes`);
      const uploadResp = await fetch(`${UPLOAD}/v1/instant_avatar/video/upload`, {
        method:  'POST',
        headers: { 'X-Api-Key': KEY, 'Content-Type': mimeType || 'video/mp4', 'Accept': 'application/json' },
        body:    buffer,
      });
      const { ok, data, status } = await safeJson(uploadResp);
      console.log(`[HeyGen] Instant avatar [${status}]:`, JSON.stringify(data).substring(0, 200));
      if (!ok) return res.status(500).json({ error: data?.message || data?.error || JSON.stringify(data).substring(0, 200) });
      const avatarId = data.data?.avatar_id || data.avatar_id || data.data?.job_id;
      return res.status(200).json({ success: true, avatarId: avatarId || 'pending_' + Date.now(), status: 'pending' });
    }

    // ══════════════════════════════════════════════════════════════════════
    // AVATAR STATUS  —  GET /v2/avatars/{avatar_id}
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'avatar-status') {
      const { avatarId } = req.body || {};
      if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });
      const r = await safeJson(await GET(`/v2/avatars/${encodeURIComponent(avatarId)}`));
      return res.status(200).json({ status: r.data?.data?.status || r.data?.data?.train_status || 'processing', name: r.data?.data?.name || '' });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (e) {
    console.error('[HeyGen] Crash:', e.message);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
