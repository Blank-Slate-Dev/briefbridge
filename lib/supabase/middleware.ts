// lib/supabase/middleware.ts
//
// Session-refresh helper called by the root proxy on every request that
// matches the matcher pattern. Two jobs:
//
//   1. Refresh the user's Supabase session if it's near expiry.
//   2. Enforce route protection: unauthenticated users hitting a protected
//      route are redirected to /login.
//
// =============================================================================
// PERFORMANCE (July 2026) — why this file no longer calls getUser()
// =============================================================================
//
// Measured problem: a single /matters load fired ~40 RSC prefetch requests
// (Next.js prefetches every visible link). The matcher matched all of them,
// and each one called supabase.auth.getUser() — a NETWORK round trip to the
// Supabase auth server in Singapore (~350-400ms from Newcastle). Result:
// 6-10s to open the app, with the browser waterfall full of 400-650ms
// fetches.
//
// Two fixes, both applied here:
//
//   1. SKIP PREFETCH/RSC REQUESTS. A prefetch is speculative and renders
//      nothing the user sees; it does not need a session refresh, and the
//      real navigation that follows still gets one. Detected via the
//      Next-Router-Prefetch / RSC headers. Protected-route enforcement is
//      still handled on the actual navigation, and every page/layout does
//      its own server-side auth check — so skipping prefetch is safe.
//
//   2. getClaims() INSTEAD OF getUser(). getClaims() verifies the JWT
//      signature LOCALLY using the project's public JWKS (cached), so it is
//      cryptographically sound without a network hop — unlike getSession(),
//      which trusts the cookie blindly. Supabase added this precisely for
//      middleware/edge use. ~5ms vs ~400ms.
//
// =============================================================================
// REDIRECT LOOP (July 2026) — the cost of local verification, and the fix
// =============================================================================
//
// Local verification has one blind spot: it proves the token was signed by
// this project and hasn't expired, but NOT that the session still exists.
// A revoked-but-unexpired token still verifies. When that happened, this
// file said "signed in" and sent /login → /matters, while the (app) layout
// called getUser(), got nothing, and sent /matters → /login. The browser
// ping-ponged until Chrome throttled navigation and rendered a blank page.
//
// The root cause was NOT the verification strategy — it was this file
// resurrecting dead cookies. setAll() stamped AUTH_COOKIE_MAX_AGE on every
// write, including the EMPTY-VALUED writes Supabase uses to CLEAR the
// session at sign-out. Sign-out therefore wrote a tombstone cookie and this
// file handed it a 400-day lifetime. Cookies are now only given a long life
// when they actually carry a value; a clear stays a clear.
//
// As a second line of defence, a page that finds getUser() empty can send
// the user to /login?stale=1, and the signed-in→app redirect below stands
// down when it sees that flag. That guarantees the loop terminates even if
// some future token state fools local verification again.
//
// PERSISTENT SESSIONS: every auth cookie we write is stamped with a long
// max-age (AUTH_COOKIE_MAX_AGE) so it PERSISTS across browser restarts.
// 400 days is the browser maximum; because this runs on every real
// navigation, an active user's cookie is continually re-issued.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 400 days in seconds — the browser maximum for a persistent cookie.
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

// Routes that require authentication. "starts-with" check.
const PROTECTED_PREFIXES = ['/chat', '/matters', '/firm', '/settings', '/billing'];

// Routes that should redirect AWAY when the user is already signed in.
const AUTH_PAGES = ['/login', '/signup'];

/**
 * True for Next.js prefetch / RSC payload requests — speculative fetches
 * the user hasn't navigated to. We let these through untouched.
 */
function isPrefetchOrRsc(request: NextRequest): boolean {
  const h = request.headers;

  // Any RSC payload request — Next appends ?_rsc=<hash> to these and sets
  // the RSC header. Verified in production waterfalls: a logged-in
  // /matters load fired ~30 of them (one per prefetchable link), each
  // previously paying a full auth round trip.
  if (request.nextUrl.searchParams.has('_rsc')) return true;
  if (h.get('rsc') === '1' || h.get('RSC') === '1') return true;

  // Explicit prefetch signals.
  return (
    h.get('next-router-prefetch') === '1' ||
    h.get('purpose') === 'prefetch' ||
    h.get('x-middleware-prefetch') === '1'
  );
}

export async function updateSession(request: NextRequest) {
  // FAST PATH: never spend auth work on speculative prefetches.
  if (isPrefetchOrRsc(request)) {
    return NextResponse.next({ request });
  }

  // Start with a passthrough response. We'll mutate it (or replace it with
  // a redirect) before returning.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            // A write with an EMPTY value is Supabase clearing the cookie —
            // sign-out, or a refresh token it has decided is dead. Honour
            // the options it gave us (which expire the cookie immediately)
            // rather than overriding them with a 400-day max-age, or the
            // cookie comes back from the dead and every later local JWT
            // check believes a session that no longer exists.
            if (!value) {
              supabaseResponse.cookies.set(name, value, options);
              return;
            }
            supabaseResponse.cookies.set(name, value, {
              ...options,
              maxAge: AUTH_COOKIE_MAX_AGE,
            });
          });
        },
      },
    },
  );

  // Verify the JWT LOCALLY (see header). Falls back to getUser() only if
  // getClaims isn't available in the installed @supabase/ssr version.
  let isAuthenticated = false;
  const authClient = supabase.auth as unknown as {
    getClaims?: () => Promise<{ data: { claims?: unknown } | null }>;
  };

  if (typeof authClient.getClaims === 'function') {
    const { data } = await authClient.getClaims();
    isAuthenticated = Boolean(data?.claims);
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  }

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthPage = AUTH_PAGES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // Circuit breaker: a server page found getUser() empty and sent the user
  // here. Local verification may still say "signed in", so the redirect
  // below would bounce them straight back. Stand down and let /login render.
  const staleSession = request.nextUrl.searchParams.get('stale') === '1';

  // Not signed in + protected route → /login, preserving intent.
  if (!isAuthenticated && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed in + /login → into the app (respecting a safe ?next=).
  if (isAuthenticated && isAuthPage && !staleSession) {
    const target = request.nextUrl.clone();
    const requestedNext = request.nextUrl.searchParams.get('next');
    target.pathname = isSafeRelativePath(requestedNext)
      ? requestedNext!
      : '/matters';
    target.search = '';
    return NextResponse.redirect(target);
  }

  return supabaseResponse;
}

/**
 * Open-redirect guard for the ?next= parameter.
 */
function isSafeRelativePath(path: string | null): boolean {
  if (!path) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  return true;
}
