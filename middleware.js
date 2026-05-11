// middleware.js — Vercel Edge Middleware
// Runs BEFORE static files. Intercepts custom domain requests
// and routes them to api/funnel.js instead of index.html

export const config = {
  matcher: ['/((?!api/).*)'],
};

export default function middleware(request) {
  const host = request.headers.get('host') || '';

  // Main platform domains — serve normally
  const mainDomains = [
    'build.skillslibry.com',
    'execution-os-xi.vercel.app',
    'localhost',
  ];

  const isMainDomain = mainDomains.some(d =>
    host === d || host.endsWith('.' + d) || host.includes('vercel.app')
  );

  // Custom member domain — route to funnel API
  if (!isMainDomain) {
    const url = new URL(request.url);
    url.hostname = 'execution-os-xi.vercel.app';
    url.pathname = '/api/funnel';
    url.searchParams.set('host', host);
    return fetch(url.toString(), {
      headers: request.headers,
    });
  }
}
