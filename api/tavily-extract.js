/**
 * POST /api/tavily-extract
 * 
 * Extracts full content from an affiliate product sales page URL.
 * Used by Offer Setup to read the actual product page before
 * feeding it into intelligence generation.
 * 
 * Body: { url: string }
 * Returns: { ok, title, content, author, publishedDate }
 */

'use strict';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  }

  const { url } = req.body || {};
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Valid URL required' });
  }

  try {
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        urls:          [url],
        extract_depth: 'advanced',   // full page extraction
        format:        'markdown',   // clean readable text
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[tavily-extract] Error:', response.status, err.slice(0, 150));
      return res.status(response.status).json({ error: 'Extract failed: ' + err.slice(0, 100) });
    }

    const data = await response.json();
    const result = (data.results || [])[0] || {};

    if (!result.raw_content && !result.content) {
      return res.status(200).json({ ok: false, error: 'No content extracted from URL' });
    }

    // Return clean extracted content
    return res.status(200).json({
      ok:      true,
      url:     result.url     || url,
      title:   result.title   || '',
      content: (result.raw_content || result.content || '').slice(0, 8000), // cap at 8k chars
    });

  } catch (err) {
    console.error('[tavily-extract] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
