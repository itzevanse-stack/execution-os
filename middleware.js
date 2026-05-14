// middleware.js — Vercel Edge Middleware
// Proxies custom member domains to api/funnel — URL stays as their domain
// API routes and static assets are explicitly excluded

export const config = {
  // Only run on non-API, non-static paths
  // This prevents middleware from interfering with serverless functions
  matcher: [
    '/((?!api/|_next/|favicon|.*\\.(?:js|css|png|jpg|ico|svg|woff|woff2|ttf|json)).*)',
  ],
};

export default async function middleware(request) {
  const host = request.headers.get('host') || '';
  const url  = request.nextUrl || new URL(request.url);

  // Never intercept API routes — let them go straight to serverless functions
  if (url.pathname.startsWith('/api/')) {
    return; // pass through
  }

  const isMain = [
    'build.skillslibry.com',
    'execution-os-xi.vercel.app',
  ].some(d => host === d || host.endsWith('.' + d))
    || host.includes('.vercel.app')
    || host.startsWith('localhost')
    || host.startsWith('127.');

  if (!isMain) {
    // Custom member domain — proxy to funnel API
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
  // Main domain — pass through normally
}
