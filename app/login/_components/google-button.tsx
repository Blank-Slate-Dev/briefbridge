// app/login/_components/google-button.tsx
//
// Google OAuth sign-in button.
//
// Why this is a Client Component:
//   The Supabase OAuth flow uses signInWithOAuth() which returns a URL the
//   browser must navigate to. That has to happen client-side because the
//   user's browser is the one Google needs to redirect back to. We could
//   also do this from a server action, but it'd add a redundant round trip
//   (server action returns URL → client navigates to it) versus the simpler
//   "click → navigate" we get from a client component.
//
// What happens when clicked:
//   1. We call supabase.auth.signInWithOAuth({ provider: 'google', ... })
//   2. Supabase returns a URL to Google's OAuth consent page
//   3. The browser navigates to Google
//   4. User signs in / consents
//   5. Google redirects back to https://<supabase>.supabase.co/auth/v1/callback
//   6. Supabase processes the code, sets cookies, then redirects to our
//      redirectTo (which is /auth/callback in our app)
//   7. Our /auth/callback route handler does any final steps (e.g. profile
//      creation hook) and redirects to the user's final destination
//
// The `redirectTo` option must be on the Supabase allowlist (we configured
// http://localhost:3000/auth/callback and http://localhost:3000/auth/callback?**
// in the dashboard in Chunk 1's setup).

'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function GoogleButton() {
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsLoading(true);

    const supabase = createClient();

    // Preserve where the user was trying to go before they hit /login.
    // The middleware sets ?next=/whatever, and we forward it through the
    // OAuth round trip as a query param on the callback URL.
    const next = searchParams.get('next') ?? '/matters';
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
        // queryParams: ask Google for a refresh token (so the session can
        // be silently refreshed later without the user re-authenticating).
        // 'consent' forces the consent screen even if the user has previously
        // granted permission — slightly more friction but ensures we always
        // get a fresh refresh_token.
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    // If we got here, signInWithOAuth has already kicked off the navigation.
    // We don't reset isLoading because we're about to leave the page.
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="bb-login-google"
        aria-label="Sign in with Google"
      >
        <GoogleLogo />
        <span>{isLoading ? 'Redirecting to Google…' : 'Continue with Google'}</span>
      </button>
      {error && (
        <div className="bb-login-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Inline Google "G" logo. Using an inline SVG instead of an image avoids
 * an extra network request and lets the colours stay vivid regardless of
 * dark/light theme.
 */
function GoogleLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
