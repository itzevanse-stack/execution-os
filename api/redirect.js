// api/redirect.js — Affiliate Link Click Tracker
// Usage: /r/:slug (routed via vercel.json rewrite)
//
// Flow:
//   1. Look up slug in Firestore → get originalUrl + userId
//   2. Log click: IP, country, city, device, browser, OS, referrer, timestamp
//   3. Redirect to originalUrl (commission-safe, full URL preserved)
//   4. All analytics writes are non-blocking — visitor always redirected

'use strict';

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }      = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })});
  }
  return getFirestore();
}

// ── Parse device / browser / OS from User-Agent ───────────────────
function parseUA(ua) {
  if (!ua) return { device: 'Unknown', browser: 'Unknown', os: 'Unknown' };
  ua = ua.toLowerCase();

  var device = 'Desktop';
  if (/ipad/.test(ua))                                      device = 'Tablet';
  else if (/mobile|android|iphone|ipod|blackberry|windows phone/.test(ua)) device = 'Mobile';

  var browser = 'Other';
  if (/edg\//.test(ua))       browser = 'Edge';
  else if (/opr\//.test(ua))  browser = 'Opera';
  else if (/chrome/.test(ua)) browser = 'Chrome';
  else if (/safari/.test(ua)) browser = 'Safari';
  else if (/firefox/.test(ua))browser = 'Firefox';
  else if (/msie|trident/.test(ua)) browser = 'Internet Explorer';

  var os = 'Other';
  if (/windows/.test(ua))    os = 'Windows';
  else if (/android/.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/.test(ua)) os = 'iOS';
  else if (/mac os/.test(ua)) os = 'macOS';
  else if (/linux/.test(ua))  os = 'Linux';

  return { device, browser, os };
}

// ── Parse traffic source from Referer header ──────────────────────
function parseSource(referer) {
  if (!referer) return 'Direct';
  var r = referer.toLowerCase();
  if (/facebook\.com|fb\.me|l\.facebook/.test(r))  return 'Facebook';
  if (/instagram\.com|ig\.me/.test(r))              return 'Instagram';
  if (/wa\.me|whatsapp/.test(r))                    return 'WhatsApp';
  if (/t\.me|telegram/.test(r))                     return 'Telegram';
  if (/twitter\.com|t\.co/.test(r))                 return 'Twitter / X';
  if (/tiktok\.com/.test(r))                        return 'TikTok';
  if (/youtube\.com/.test(r))                       return 'YouTube';
  if (/linkedin\.com/.test(r))                      return 'LinkedIn';
  if (/mail\.|gmail|yahoo|outlook|substack/.test(r))return 'Email';
  if (/google\.com/.test(r))                        return 'Google';
  return 'Other';
}

// ── Get real IP from Vercel headers ──────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || '0.0.0.0';
}

// ── Geo-lookup via ip-api.com (free, no key needed) ──────────────
async function geoLookup(ip) {
  // Skip lookups for private/localhost IPs
  if (!ip || ip === '0.0.0.0' || ip.startsWith('127.') || ip.startsWith('::')) {
    return { country: 'Local', countryCode: '--', city: 'Local', region: '', isp: '' };
  }
  try {
    const resp = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,lat,lon`,
      { signal: AbortSignal.timeout(2000) } // 2s max — never block redirect
    );
    if (!resp.ok) return {};
    const data = await resp.json();
    if (data.status !== 'success') return {};
    return {
      country:     data.country     || '',
      countryCode: data.countryCode || '',
      city:        data.city        || '',
      region:      data.regionName  || '',
      isp:         data.isp         || '',
      lat:         data.lat         || null,
      lon:         data.lon         || null,
    };
  } catch(e) {
    return {};
  }
}

// ── HTML fallback page (if JS is disabled) ────────────────────────
function fallbackHTML(url) {
  return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"><title>Redirecting…</title></head><body><script>window.location.href="${url.replace(/"/g,'&quot;')}"<\/script><p>Redirecting… <a href="${url}">Click here if not redirected</a></p></body></html>`;
}

// ═════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  const slug = req.query.slug || (req.url || '').split('/r/')[1]?.split('?')[0];

  // Handle expert source slugs — format: baseslug_src (e.g. abc12xyz_ig)
  // Strip the source suffix to look up the base link, but preserve the source for analytics
  const slugParts  = slug ? slug.split('_') : [];
  const sourceTag  = slugParts.length > 1 ? slugParts[slugParts.length - 1] : null;
  const KNOWN_SRCS = ['ig','fb','email','dm','wa','tt'];
  const baseSlug   = (sourceTag && KNOWN_SRCS.includes(sourceTag))
    ? slugParts.slice(0, -1).join('_')
    : slug;

  if (!slug) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }

  let originalUrl = null;
  let userId      = null;

  // ── 1. Look up slug in Firestore ──────────────────────────────
  try {
    const db = getDb();
    // Try full slug first (expert source link: baseslug_src stored as uid_src doc)
    // Then fall back to base slug query
    let snap = await db.collection('links').where('slug','==',slug).limit(1).get();
    if (snap.empty && baseSlug !== slug) {
      snap = await db.collection('links').where('slug','==',baseSlug).limit(1).get();
    }
    if (!snap.empty) {
      const data = snap.docs[0].data();
      originalUrl = data.originalUrl || data.url || null;
      userId      = data.userId      || null;
    }
  } catch(e) {
    console.error('[redirect] Firestore lookup failed:', e.message);
  }

  // ── 2. If slug not found, redirect to homepage ────────────────
  if (!originalUrl) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }

  // ── 3. Send redirect IMMEDIATELY (commission always safe) ─────
  //    Do this before any async work so the visitor never waits
  res.setHeader('Location',     originalUrl);
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.status(302).end();

  // ── 4. Log click asynchronously (non-blocking) ───────────────
  //    Fire-and-forget: if this fails, the redirect already happened
  ;(async () => {
    try {
      const ip      = getIP(req);
      const ua      = req.headers['user-agent'] || '';
      const referer = req.headers['referer'] || req.headers['referrer'] || '';

      const [geo, parsed] = await Promise.all([
        geoLookup(ip),
        Promise.resolve(parseUA(ua)),
      ]);

      const sourceFromReferer = parseSource(referer);
      const SOURCE_TAGS = { ig:'Instagram', fb:'Facebook', email:'Email', dm:'DM', wa:'WhatsApp', tt:'TikTok' };
      const sourceFromTag = sourceTag ? (SOURCE_TAGS[sourceTag] || sourceTag) : null;
      const source = sourceFromTag || sourceFromReferer;

      const clickData = {
        slug,
        baseSlug: baseSlug || slug,
        sourceTag: sourceTag || null,
        userId:      userId || null,
        originalUrl,
        timestamp:   FieldValue.serverTimestamp(),
        timestampMs: Date.now(),
        ip,
        // Geo
        country:     geo.country     || 'Unknown',
        countryCode: geo.countryCode || '--',
        city:        geo.city        || 'Unknown',
        region:      geo.region      || '',
        isp:         geo.isp         || '',
        lat:         geo.lat         || null,
        lon:         geo.lon         || null,
        // Device
        device:      parsed.device,
        browser:     parsed.browser,
        os:          parsed.os,
        // Source
        source,
        referer:     referer.slice(0, 500), // cap length
        userAgent:   ua.slice(0, 300),
        // Uniqueness — tracked by IP per slug per day
        uniqueKey:   slug + '_' + ip + '_' + new Date().toISOString().slice(0,10),
      };

      const db = getDb();

      // Write click event
      const clickRef = db
        .collection('clicks').doc(userId || 'anonymous')
        .collection('events').doc();
      await clickRef.set(clickData);

      // Increment counters on the link document (for fast stats reads)
      const linkRef = db.collection('links').where('slug','==',slug);
      const linkSnap = await linkRef.limit(1).get();
      if (!linkSnap.empty) {
        // Check if this IP+day combination already exists (unique click detection)
        const uniqueSnap = await db
          .collection('clicks').doc(userId || 'anonymous')
          .collection('events')
          .where('uniqueKey','==',clickData.uniqueKey)
          .limit(2)
          .get();
        const isUnique = uniqueSnap.size <= 1; // <= 1 because we just wrote one

        await linkSnap.docs[0].ref.update({
          totalClicks:  FieldValue.increment(1),
          uniqueClicks: FieldValue.increment(isUnique ? 1 : 0),
          lastClickAt:  FieldValue.serverTimestamp(),
        });
      }

      console.log(`[redirect] ✅ ${slug} → ${country || '?'} ${city || ''} ${source} ${device}`);
    } catch(e) {
      // Silent — redirect already sent, user unaffected
      console.warn('[redirect] Analytics write failed:', e.message);
    }
  })();
};
