// middleware.js — handles custom member funnel domains only
// Runs on Vercel Edge before any serverless functions

export const config = {
  matcher: '/:path*',
};

export default async function middleware(request) {
  const host = request.headers.get('host') || '';
  const path = new URL(request.url).pathname;

  // Never intercept API routes, static files, or Vercel internals
  if (
    path.startsWith('/api/') ||
    path.startsWith('/_next/') ||
    path.startsWith('/_vercel/') ||
    path.endsWith('.js') || path.endsWith('.css') ||
    path.endsWith('.html') || path.endsWith('.ico') ||
    path.endsWith('.png') || path.endsWith('.svg') ||
    path.endsWith('.json') || path.endsWith('.woff') ||
    path.endsWith('.woff2') || path.endsWith('.ttf')
  ) {
    return; // pass through untouched
  }

  // Main platform domains — pass through untouched
  const isMain =
    host === 'build.skillslibry.com' ||
    host === 'execution-os-xi.vercel.app' ||
    host.endsWith('.vercel.app') ||
    host.startsWith('localhost') ||
    host.startsWith('127.');

  if (isMain) return; // pass through

  // Custom member domain — serve their funnel
  // Pass the host so /api/funnel can look it up in Firestore
  try {
    const origin = 'https://execution-os-xi.vercel.app';
    const qs = '?host=' + encodeURIComponent(host) + (path !== '/' ? '&page=' + encodeURIComponent(path.replace(/^\//, '')) : '');
    const resp = await fetch(origin + '/api/funnel' + qs, {
      headers: {
        'x-forwarded-host': host,
        'x-real-host':      host,
        'user-agent':       request.headers.get('user-agent') || '',
      },
    });
    const html = await resp.text();
    return new Response(html, {
      status:  resp.status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-served-by': 'eos-funnel' },
    });
  } catch(e) {
    return new Response('<html><body style="font-family:sans-serif;padding:40px;background:#07070f;color:#888"><h2 style="color:#fff">Loading your funnel...</h2><p>If this persists, the funnel may not be published yet.</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
}
