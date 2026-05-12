// app/auth/callback/route.ts
//
// OAuth and email-confirmation callback handler.
//
// Two flows land here:
//   1. Google OAuth: after the user authenticates with Google, Supabase
//      receives the code at https://<project>.supabase.co/auth/v1/callback
//      and then redirects to OUR app at /auth/callback with a `code` query
//      param. We exchange that code for a session.
//   2. Email confirmation: when a user clicks the link in their sign-up
//      confirmation email, Supabase routes them here with a `code` param
//      that we exchange for a session.
//
// Both flows use the same `code` exchange, so this handler treats them
// uniformly. The only difference is where we redirect afterwards:
//   - OAuth carries a `?next=` param set by GoogleButton (defaults to
//     /matters).
//   - Email confirmation has no `next` param; we default to /matters.
//
// Why this is a Route Handler (route.ts) and not a Page:
//   We never want to render anything here — we just process the code and
//   redirect. Route handlers are the right primitive for "do work, then
//   redirect" with no UI.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Where to send the user after a successful auth.
  // Defensive: only accept relative paths starting with a single `/`.
  const requestedNext = searchParams.get('next');
  const next = isSafeRelativePath(requestedNext) ? requestedNext! : '/matters';

  // If Supabase returned an explicit error (e.g. user denied the OAuth
  // consent, expired link), redirect to the error page with details.
  if (error) {
    const errorUrl = new URL('/auth/auth-code-error', origin);
    errorUrl.searchParams.set(
      'reason',
      errorDescription || error,
    );
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    // No code, no error — someone hit /auth/callback directly. Bounce them
    // to the login page rather than error out.
    return NextResponse.redirect(new URL('/login', origin));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const errorUrl = new URL('/auth/auth-code-error', origin);
    errorUrl.searchParams.set('reason', exchangeError.message);
    return NextResponse.redirect(errorUrl);
  }

  // Auth cookies are now set. Send the user to their destination.
  return NextResponse.redirect(new URL(next, origin));
}

function isSafeRelativePath(path: string | null): boolean {
  if (!path) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  return true;
}
