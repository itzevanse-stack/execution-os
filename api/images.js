// api/images.js — Pexels image search proxy
// Fetches niche-relevant background images for carousel slides.
// Keeps the Pexels API key server-side.
//
// POST body: { queries: ["keyword1", "keyword2", ...], perQuery: 1 }
// Returns:   { images: [ { url, photographer, alt } ] }

'use strict';

const PEXELS_KEY = process.env.PEXELS_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!PEXELS_KEY) {
    return res.status(500).json({ error: 'PEXELS_API_KEY not configured' });
  }

  const { queries = [], perQuery = 1 } = req.body || {};
  if (!queries.length) return res.status(400).json({ error: 'queries array required' });

  const images = [];

  for (const query of queries.slice(0, 10)) {
    try {
      const search = encodeURIComponent(query + ' lifestyle professional');
      const resp   = await fetch(
        `https://api.pexels.com/v1/search?query=${search}&per_page=${perQuery}&orientation=square`,
        { headers: { Authorization: PEXELS_KEY } }
      );
      if (!resp.ok) { images.push(null); continue; }
      const data = await resp.json();
      const photo = data.photos && data.photos[0];
      if (photo) {
        images.push({
          url:          photo.src.large2x || photo.src.large || photo.src.original,
          photographer: photo.photographer,
          alt:          photo.alt || query,
        });
      } else {
        images.push(null);
      }
    } catch(e) {
      console.warn('[images] Query failed:', query, e.message);
      images.push(null);
    }
  }

  return res.status(200).json({ images });
};
