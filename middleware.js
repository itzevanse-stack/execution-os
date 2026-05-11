// middleware.js — Vercel Edge Middleware
// Proxies custom member domains to api/funnel — URL stays as their domain

export const config = { matcher: '/:path*' };

export default async function middleware(request) {
  const host = request.headers.get('host') || '';

  const isMain = [
    'build.skillslibry.com',
    'execution-os-xi.vercel.app',
  ].some(d => host === d || host.endsWith('.' + d))
    || host.includes('.vercel.app')
    || host.startsWith('localhost')
    || host.startsWith('127.');

  if (!isMain) {
    // Proxy to funnel API — browser URL stays as www.theirdomain.com
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
}
