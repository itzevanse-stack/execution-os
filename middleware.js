// middleware.js — Vercel Edge Middleware
// Runs before static files. Routes custom member domains to api/funnel

export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const host = request.headers.get('host') || '';

  const mainDomains = [
    'build.skillslibry.com',
    'execution-os-xi.vercel.app',
  ];

  const isMain = mainDomains.some(d => host === d || host.endsWith('.' + d))
    || host.includes('.vercel.app')
    || host.startsWith('localhost')
    || host.startsWith('127.');

  if (!isMain) {
    const dest = new URL(request.url);
    dest.host     = 'execution-os-xi.vercel.app';
    dest.pathname = '/api/funnel';
    dest.searchParams.set('host', host);
    return Response.redirect(dest.toString(), 302);
  }
}
