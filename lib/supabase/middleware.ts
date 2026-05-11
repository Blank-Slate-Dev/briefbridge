// lib/supabase/middleware.ts
//
// Session-refresh helper called by the root middleware.ts on every request
// that matches the matcher pattern. Two jobs:
//
//   1. Refresh the user's Supabase session if it's near expiry. JWTs are
//      short-lived (default 1 hour) and Supabase issues refresh tokens
//      for keeping users signed in. We do the refresh server-side so the
//      browser never has to think about it.
//
//   2. Enforce route protection: if the user is NOT signed in and is
//      trying to hit a protected route, redirect to /login.
//
// What counts as "protected" is decided here (not in a separate config) so
// it sits next to the auth logic. The (app) route group is implementation
// detail — Next.js exposes its routes as plain paths, so the matcher works
// on the literal URL prefix.
//
// CRITICAL: we must call supabase.auth.getUser() (NOT getSession()) here.
// getSession() returns the cached session object from the cookies without
// validating its signature against Supabase. getUser() makes a server-side
// call to Supabase's auth server, which is the only way to be sure the
// JWT hasn't been tampered with. The performance cost is small (sub-100ms
// from Vercel → Supabase Singapore) and the alternative is a security hole.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that require authentication. Order matters only for readability;
// it's a "starts-with" check.
const PROTECTED_PREFIXES = ['/chat', '/matters'];

// Routes that should redirect AWAY from /login when the user is already
// signed in. /cases is intentionally NOT here — it's public.
const AUTH_PAGES = ['/login', '/signup'];

export async function updateSession(request: NextRequest) {
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
          // When Supabase refreshes the session, it writes new cookies.
          // We have to copy them onto BOTH the request (so any downstream
          // server code in this same request sees the new session) AND the
          // response (so the browser receives them).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validate the session against Supabase's auth server.
  // This must happen BEFORE any redirect logic below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthPage = AUTH_PAGES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // Not signed in + visiting a protected route → bounce to /login,
  // preserving where they were trying to go so we can send them back
  // after sign-in.
  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Already signed in + visiting /login → bounce them into the app.
  // Respects ?next= if it's a safe internal path.
  if (user && isAuthPage) {
    const target = request.nextUrl.clone();
    const requestedNext = request.nextUrl.searchParams.get('next');
    target.pathname = isSafeRelativePath(requestedNext) ? requestedNext! : '/matters';
    target.search = '';
    return NextResponse.redirect(target);
  }

  return supabaseResponse;
}

/**
 * Open redirects are a classic auth vulnerability — if we trust the `next`
 * query parameter unconditionally, a malicious link like
 *   /login?next=https://evil.com
 * would redirect signed-in users off-site. We only allow paths that:
 *   - Start with exactly one `/`
 *   - Don't start with `//` (which browsers treat as protocol-relative)
 *   - Don't start with `/\` (Windows-style path traversal trick)
 */
function isSafeRelativePath(path: string | null): boolean {
  if (!path) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  return true;
}
