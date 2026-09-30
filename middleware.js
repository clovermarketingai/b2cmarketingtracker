import { NextResponse } from 'next/server';
import { COOKIE, verifyToken, extractApiKey, apiKeyOk, cronSecretOk } from './lib/auth';

// Where an already signed-in visit to /login is sent.
const HOME = '/';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;
  const cookie = request.cookies.get(COOKIE);
  const token = cookie ? cookie.value : '';
  // verifyToken fails closed when APP_PASSWORD / SESSION_SECRET are missing.
  const authed = token ? await verifyToken(token) : false;

  if (pathname === '/login' || pathname === '/api/login') {
    if (authed && pathname === '/login') {
      const home = request.nextUrl.clone();
      home.pathname = HOME;
      home.search = '';
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // Machine access: the external read API takes the dashboard API key
  // (or a signed-in browser session); cron endpoints take the cron secret.
  // Both fail closed when their env var is unset.
  if (pathname.startsWith('/api/v1/')) {
    const key = extractApiKey(request);
    if ((key && await apiKeyOk(key)) || authed) return NextResponse.next();
    return NextResponse.json({ error: 'unauthorised', hint: 'Send Authorization: Bearer <DASHBOARD_API_KEY>' }, { status: 401 });
  }
  if (pathname.startsWith('/api/cron/')) {
    // Cron writes (snapshots), so the read-only API key does not open it.
    const key = extractApiKey(request);
    if (key && await cronSecretOk(key)) return NextResponse.next();
    return NextResponse.json({ error: 'unauthorised', hint: 'Send Authorization: Bearer <CRON_SECRET>' }, { status: 401 });
  }

  if (authed) return NextResponse.next();

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}
