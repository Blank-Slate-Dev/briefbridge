// app/auth/signout/route.ts
//
// Sign-out endpoint. POST-only by design.
//
// Why POST and not GET:
//   GET requests are idempotent and can be triggered by any link, prefetch,
//   or image src. If sign-out were a GET, a malicious page could embed
//   <img src="/auth/signout" /> on a different site and sign your users out
//   when they viewed it (a CSRF-style annoyance, though not a serious data
//   breach risk). POST + a form submission requires a deliberate user
//   action and an action of "same origin", which browsers enforce.
//
// Usage:
//   The sidebar user button (Chunk 2) submits a hidden <form action="/auth/signout"
//   method="post"> when the user clicks "Sign out".

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // signOut() clears the session cookies. It's safe to call even when
  // there's no active session (Supabase handles that gracefully).
  await supabase.auth.signOut();

  // Send the user to the homepage. We could send them to /login but home
  // is friendlier for a marketing-led product where users might want to
  // browse public case law without an account.
  const { origin } = new URL(request.url);
  return NextResponse.redirect(new URL('/', origin), {
    // Override the default 307 to 303 — for a POST → GET redirect we want
    // the browser to issue a fresh GET. 307 preserves the method (would
    // send a POST to /, which doesn't exist). 303 explicitly says "after
    // this redirect, do a GET". Most browsers handle 307 here too but 303
    // is the spec-correct status for this case.
    status: 303,
  });
}
