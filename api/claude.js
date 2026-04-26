export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};

    // ── Optional: fetch a URL server-side and inject content into the prompt ──
    if (body.fetchUrl) {
      try {
        const pageRes = await fetch(body.fetchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExecutionOS/1.0)' },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        });
        const html = await pageRes.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
          .slice(0, 6000);

        if (body.messages && body.messages.length > 0) {
          body.messages[0].content =
            `SALES PAGE CONTENT FROM ${body.fetchUrl}:\n\n${text}\n\n---\n\n${body.messages[0].content}`;
        }
      } catch (fetchErr) {
        console.warn('URL fetch failed:', fetchErr.message);
      }
      delete body.fetchUrl;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
