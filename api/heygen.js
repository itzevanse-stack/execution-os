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

    // HeyGen's documented error shape is { error: { code, message, param,
    // doc_url } } — a nested object, not a string. Always unwrap it properly
    // here so the frontend never receives an object and stringifies it as
    // "[object Object]" via new Error(obj).
    function extractErrorMessage(data, fallback) {
      if (!data) return fallback;
      if (typeof data.message === 'string' && data.message) return data.message;
      if (typeof data.error === 'string' && data.error) return data.error;
      if (data.error && typeof data.error === 'object') {
        if (typeof data.error.message === 'string' && data.error.message) return data.error.message;
        try { return JSON.stringify(data.error).substring(0, 200); } catch(e) {}
      }
      return fallback;
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
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'Failed to fetch avatars') });
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
      // Migrated to v3 + filtered to type:"public" only — v2 doesn't
      // reliably expose a type field, and without it there's no way to
      // exclude other users' cloned voices from this shared-account list.
      // HeyGen confirms "public" as the real value for genuine stock voices
      // (developers.heygen.com/docs/voices/search-voices).
      const r = await safeJson(await GET('/v3/voices?limit=100'));
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'Failed to fetch voices') });
      const raw = Array.isArray(r.data?.data) ? r.data.data : (r.data?.data?.voices || []);
      const voices = raw
        .filter(v => (v.type || 'public') === 'public') // exclude cloned/private voices from the shared list
        .map(v => ({
          voice_id:     v.voice_id,
          display_name: v.name || v.display_name || v.voice_id,
          language:     v.language || 'Other',
          gender:       v.gender || '',
          preview_url:  v.preview_audio_url || v.preview_audio || '',
        }));
      return res.status(200).json({ voices });
    }

    // ══════════════════════════════════════════════════════════════════════
    // CLONE VOICE  —  POST /v3/voices/clone
    // Instant voice clone from a short audio sample (30s+ recommended).
    // Returns a voice_id usable anywhere voiceId is accepted in `generate`.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'clone-voice') {
      const { audioData, mimeType, voiceName, language } = req.body || {};
      if (!audioData) return res.status(400).json({ error: 'Missing audioData' });
      if (!voiceName || !voiceName.trim()) return res.status(400).json({ error: 'Missing voiceName' });

      const buffer = Buffer.from(audioData, 'base64');
      // Roughly 25MB safety cap — base64 inflates size ~33%, so check the decoded buffer
      if (buffer.length > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'Audio file too large. Please use a clip under 25MB (a minute or two of clear speech is plenty).' });
      }

      console.log(`[HeyGen] Cloning voice "${voiceName}" — ${buffer.length} bytes, ${mimeType || 'unknown type'}`);

      // POST /v3/voices/clone — real, confirmed schema (developers.heygen.com/reference/clone-a-voice).
      // Takes a JSON body, NOT multipart/form-data — that was the bug causing
      // "Request body must be valid JSON". The audio field supports base64
      // directly, so no separate file upload/public URL is needed here
      // (unlike Digital Twin, which genuinely does require a public URL).
      const payload = {
        audio: {
          type:       'base64',
          media_type: mimeType || 'audio/mpeg',
          data:       audioData,
        },
        voice_name: voiceName.trim().slice(0, 100),
        remove_background_noise: true,
      };
      if (language) payload.language = language;

      const resp = await fetch(`${API}/v3/voices/clone`, {
        method:  'POST',
        headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const { ok, data, status } = await safeJson(resp);
      console.log(`[HeyGen] Voice clone [${status}]:`, JSON.stringify(data).substring(0, 200));

      if (!ok) {
        return res.status(200).json({ error: extractErrorMessage(data, `Voice cloning failed (${status}).`) });
      }

      const voiceCloneId = data?.data?.voice_clone_id;
      if (!voiceCloneId) {
        return res.status(200).json({ error: 'HeyGen accepted the request but did not return a voice_clone_id: ' + JSON.stringify(data).substring(0, 200) });
      }
      return res.status(200).json({ success: true, voiceId: voiceCloneId, status: 'processing' });
    }

    // ══════════════════════════════════════════════════════════════════════
    // VOICE CLONE STATUS  —  GET /v3/voices/{voice_clone_id}
    // The exact response shape for this specific status field isn't fully
    // documented (only "returns clone workflow status when available" is
    // confirmed) — parsed defensively across a few reasonable field paths
    // rather than assumed. Logs the raw shape if none match, so this can be
    // tightened once a real response is seen.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'voice-clone-status') {
      const { voiceId } = req.body || {};
      if (!voiceId) return res.status(400).json({ error: 'Missing voiceId' });

      const resp = await GET(`/v3/voices/${encodeURIComponent(voiceId)}`);
      if (resp.status === 404) {
        return res.status(200).json({ status: 'not_found' });
      }
      const r = await safeJson(resp);
      if (!r.ok) {
        return res.status(200).json({ status: 'unknown', error: extractErrorMessage(r.data, `Status check failed (${r.status})`) });
      }

      const d = r.data?.data || r.data || {};
      const rawStatus = d.status || d.clone_status || d.voice?.status || '';
      if (!rawStatus) {
        console.warn('[HeyGen] Voice clone status — could not find a status field. Raw keys:', Object.keys(d));
      }
      // Treat anything not explicitly "processing"/"pending" as usable —
      // avoids blocking forever on an unconfirmed field name.
      const normalized = /complete|ready|success/i.test(rawStatus) ? 'complete'
                        : /fail|error/i.test(rawStatus) ? 'failed'
                        : rawStatus || 'unknown';
      return res.status(200).json({ status: normalized, raw: rawStatus });
    }

    // ══════════════════════════════════════════════════════════════════════
    // LIST AVATAR GROUPS  —  GET /v2/photo_avatar_group/list
    // Shows user's saved photo avatars — used to reuse without re-uploading
    // Each group has looks; each look has a talking_photo_id for video generation
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'list-avatar-groups') {
      // Correct endpoint per HeyGen docs: /v2/avatar_group.list
      const r = await safeJson(await GET('/v2/avatar_group.list'));
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'Failed to fetch avatar groups') });
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
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'Failed to fetch group avatars') });
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
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'Failed to list talking photos') });
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
      if (!r.ok) return res.status(500).json({ error: extractErrorMessage(r.data, 'AI avatar generation failed') });
      return res.status(200).json({ success: true, generationId: r.data?.data?.generation_id });
    }

    // ══════════════════════════════════════════════════════════════════════
    // GENERATE VIDEO  —  POST /v2/video/generate
    // Supports: stock avatars, talking photos, instant avatars (digital twins)
    // Avatar IV supported via use_avatar_iv_model flag
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'generate') {
      const { script, scenes, avatarId, talkingPhotoId, voiceId, type, title, useAvatarIV } = req.body || {};
      // Accept either a single `script` string (existing behavior) or a `scenes`
      // array for multi-scene videos: [{ script, background }, { script, background }, ...]
      const sceneList = Array.isArray(scenes) && scenes.length ? scenes : (script ? [{ script }] : null);
      if (!sceneList) return res.status(400).json({ error: 'Missing script or scenes' });

      // Resolve voice once, reused across all scenes for a consistent narrator
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

      // Build character once, reused across all scenes
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
      if (useAvatarIV && talkingPhotoId) character.use_avatar_iv_model = true;

      const vertical  = ['reel', 'shorts', 'story'].includes(type);
      const dimension = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

      // Default backgrounds rotate through a small palette so multi-scene videos
      // get visual variety instead of one flat color start to finish
      const defaultBgPalette = ['#1a1a2e', '#16213e', '#0f3460', '#1a1a2e'];

      const video_inputs = sceneList.slice(0, 10).map((scene, i) => ({
        character,
        voice: {
          type:       'text',
          input_text: String(scene.script || '').trim().substring(0, 1500),
          voice_id:   finalVoiceId,
          speed:      1.0,
        },
        background: scene.background
          ? (typeof scene.background === 'string'
              ? { type: 'color', value: scene.background }
              : scene.background) // allow passing a full { type:'image'|'video', url } object
          : { type: 'color', value: defaultBgPalette[i % defaultBgPalette.length] },
      }));

      const payload = {
        video_inputs,
        dimension,
        // Real captions on — previously hardcoded to `false`. Note: /v2/video/generate
        // takes a plain boolean here (the object-with-style shape is for the newer
        // /v3/videos endpoint). Some accounts have reported inconsistent caption
        // rendering with this flag — worth a live test video to confirm it burns in.
        caption: true,
        title: title || ('EOS-' + new Date().toISOString().split('T')[0] + '-' + Date.now().toString().slice(-4)),
      };

      console.log('[HeyGen] Generate:', type, character.type, talkingPhotoId || avatarId || 'auto', '—', video_inputs.length, 'scene(s)');

      const r = await safeJson(await POST('/v2/video/generate', payload));
      if (!r.ok) {
        return res.status(500).json({ error: extractErrorMessage(r.data, JSON.stringify(r.data).substring(0, 300)) });
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
    //
    // Real response shape (verified against HeyGen docs, Aug 2026):
    //   { "data": { "languages": ["en", "es", "fr", "de", "ja", ...] } }
    // These are short codes, NOT full names — but the /v2/video_translate
    // creation endpoint below requires full names ("Spanish", not "es").
    // So we map codes -> display names here, server-side, once, and always
    // return { code, name } pairs. The frontend submits `name` as
    // output_language to match what the translate-creation endpoint expects.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'get-languages') {
      const LANG_NAMES = {
        en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian',
        pt:'Portuguese', 'pt-br':'Portuguese (Brazil)', nl:'Dutch', pl:'Polish',
        ru:'Russian', tr:'Turkish', ar:'Arabic', he:'Hebrew', hi:'Hindi',
        bn:'Bengali', ur:'Urdu', id:'Indonesian', ms:'Malay', th:'Thai',
        vi:'Vietnamese', ja:'Japanese', ko:'Korean', 'zh':'Chinese (Mandarin)',
        'zh-cn':'Chinese (Simplified)', 'zh-tw':'Chinese (Traditional)',
        sv:'Swedish', no:'Norwegian', da:'Danish', fi:'Finnish', el:'Greek',
        cs:'Czech', sk:'Slovak', hu:'Hungarian', ro:'Romanian', bg:'Bulgarian',
        uk:'Ukrainian', hr:'Croatian', sr:'Serbian', sl:'Slovenian',
        lt:'Lithuanian', lv:'Latvian', et:'Estonian', fa:'Persian',
        sw:'Swahili', am:'Amharic', af:'Afrikaans', zu:'Zulu', xh:'Xhosa',
        ta:'Tamil', te:'Telugu', ml:'Malayalam', kn:'Kannada', gu:'Gujarati',
        mr:'Marathi', pa:'Punjabi', ne:'Nepali', si:'Sinhala', my:'Burmese',
        km:'Khmer', lo:'Lao', ka:'Georgian', hy:'Armenian', az:'Azerbaijani',
        kk:'Kazakh', uz:'Uzbek', mn:'Mongolian', is:'Icelandic', ga:'Irish',
        cy:'Welsh', mt:'Maltese', sq:'Albanian', mk:'Macedonian', bs:'Bosnian',
        eu:'Basque', ca:'Catalan', gl:'Galician',
      };
      const r = await safeJson(await GET('/v2/video_translate/target_languages'));
      const codes = r.data?.data?.languages || [];
      const languages = codes.map(code => ({
        code,
        name: LANG_NAMES[code.toLowerCase()] || code,
      }));
      return res.status(200).json({ languages });
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
    // CREATE DIGITAL TWIN (video-based custom avatar)
    // POST https://api.heygen.com/v2/video_avatar
    // Real, documented endpoint (docs.heygen.com/reference/submit-video-avatar-creation-request).
    //
    // IMPORTANT — this is genuinely different from photo avatars:
    // 1. Enterprise-only, consumes API credits. If the account isn't on that
    //    tier, HeyGen will return an error here — surfaced clearly below,
    //    not silently swallowed.
    // 2. Requires two SEPARATE public video URLs (not raw file uploads):
    //    trainingFootageUrl (>=30s, 720p+, direct .mp4) and consentUrl
    //    (a video where the person states consent). Google Drive links do
    //    NOT work — must be direct-access URLs (Firebase Storage works).
    // 3. Training takes 2-4 HOURS, not minutes. This endpoint only submits
    //    the job — status is checked separately, and should be polled by a
    //    cron on a long interval (30+ min), never a live UI spinner.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'create-avatar') {
      const { trainingFootageUrl, consentUrl, avatarName } = req.body || {};
      if (!trainingFootageUrl) return res.status(400).json({ error: 'Missing trainingFootageUrl' });
      if (!consentUrl)         return res.status(400).json({ error: 'Missing consentUrl' });
      if (!avatarName)         return res.status(400).json({ error: 'Missing avatarName' });

      const payload = {
        training_footage_url: trainingFootageUrl,
        video_consent_url:    consentUrl,
        avatar_name:          avatarName,
      };

      console.log('[HeyGen] Submitting Digital Twin creation:', avatarName);
      const r = await safeJson(await POST('/v2/video_avatar', payload));
      console.log(`[HeyGen] Digital Twin submit [${r.status}]:`, JSON.stringify(r.data).substring(0, 300));

      if (!r.ok) {
        // Specifically flag the most likely real-world failure — plan tier —
        // so it's obvious in the response, not just a generic error string.
        const msg = extractErrorMessage(r.data, `Digital Twin submission failed (${r.status})`);
        const isPlanIssue = r.status === 403 || /enterprise|plan|permission|not authorized/i.test(msg);
        return res.status(200).json({
          error: isPlanIssue
            ? 'Your HeyGen account does not appear to have access to Digital Twin creation — this feature requires an Enterprise plan. (' + msg + ')'
            : msg,
        });
      }

      const avatarId = r.data?.data?.avatar_id || r.data?.data?.id;
      if (!avatarId) {
        return res.status(200).json({ error: 'HeyGen accepted the request but did not return an avatar_id: ' + JSON.stringify(r.data).substring(0, 200) });
      }
      return res.status(200).json({ success: true, avatarId, status: 'in_progress' });
    }

    // ══════════════════════════════════════════════════════════════════════
    // DIGITAL TWIN STATUS  —  GET /v2/video_avatar/{avatar_id}
    // Real, documented endpoint (docs.heygen.com/reference/check-video-avatar-generation-status).
    // NOT the same as /v2/avatars/{id} (that's for stock/photo avatars).
    // Documented statuses: in_progress | complete | failed
    // 404 means the avatar_id doesn't exist on this account at all.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'avatar-status') {
      const { avatarId } = req.body || {};
      if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

      const resp = await GET(`/v2/video_avatar/${encodeURIComponent(avatarId)}`);
      if (resp.status === 404) {
        return res.status(200).json({ status: 'not_found', error: 'This Digital Twin ID was not found on your HeyGen account.' });
      }

      const r = await safeJson(resp);
      if (!r.ok) {
        return res.status(200).json({ status: 'error', error: extractErrorMessage(r.data, `Status check failed (${r.status})`) });
      }

      const info = r.data?.data || {};
      return res.status(200).json({
        status:  info.status || 'in_progress', // in_progress | complete | failed
        name:    info.name || info.avatar_name || '',
        avatarId: info.avatar_id || info.id || avatarId,
        error:   info.error || info.failure_reason || null,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PROXY VIDEO  —  streams the HeyGen MP4 through Vercel
    // Avoids geo-blocking / CDN auth issues on files2.heygen.ai
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'proxy-video') {
      const { videoUrl } = req.body || {};
      if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });
      // Only allow HeyGen CDN URLs
      if (!videoUrl.includes('heygen.ai') && !videoUrl.includes('heygen.com')) {
        return res.status(400).json({ error: 'Invalid video URL' });
      }
      try {
        const videoResp = await fetch(videoUrl, {
          headers: { 'X-Api-Key': KEY }
        });
        if (!videoResp.ok) return res.status(502).json({ error: 'HeyGen CDN returned ' + videoResp.status });
        res.setHeader('Content-Type', videoResp.headers.get('content-type') || 'video/mp4');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buffer = await videoResp.arrayBuffer();
        return res.status(200).send(Buffer.from(buffer));
      } catch(e) {
        return res.status(502).json({ error: 'Failed to proxy video: ' + e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (e) {
    console.error('[HeyGen] Crash:', e.message);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
