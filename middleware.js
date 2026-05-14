// middleware.js — Vercel Edge Middleware
// ONLY purpose: proxy custom member domains to the funnel API
// Main domain and ALL API routes pass through untouched

export const config = {
  matcher: '/:path*',
};

export default async function middleware(request) {
  const host = request.headers.get('host') || '';
  const path = new URL(request.url).pathname;

  // ── ALWAYS pass through these — never intercept ──────────────────────────
  // API functions, static files, Vercel internals
  if (
    path.startsWith('/api/') ||
    path.startsWith('/_next/') ||
    path.startsWith('/_vercel/') ||
    path.includes('.js') ||
    path.includes('.css') ||
    path.includes('.html') ||
    path.includes('.ico') ||
    path.includes('.png') ||
    path.includes('.svg') ||
    path.includes('.json') ||
    path.includes('.woff')
  ) {
    return; // pass through — do nothing
  }

  // ── Main domain — pass through untouched ─────────────────────────────────
  const isMain =
    host === 'build.skillslibry.com' ||
    host === 'execution-os-xi.vercel.app' ||
    host.endsWith('.vercel.app') ||
    host.startsWith('localhost') ||
    host.startsWith('127.');

  if (isMain) {
    return; // pass through — do nothing
  }

  // ── Custom member domain — proxy to funnel API ───────────────────────────
  try {
    const apiUrl = 'https://execution-os-xi.vercel.app/api/funnel?host=' + encodeURIComponent(host);
    const resp = await fetch(apiUrl, { headers: { 'x-forwarded-host': host } });
    const html = await resp.text();
    return new Response(html, {
      status: resp.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch(e) {
    return new Response('<html><body><p>Loading...</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
}
