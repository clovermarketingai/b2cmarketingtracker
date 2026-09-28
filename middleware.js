import { NextResponse } from 'next/server';
import { COOKIE, verifyToken } from './lib/auth';

// Where an already signed-in visit to /login is sent.
const HOME = '/daily';

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

  if (authed) return NextResponse.next();

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}
