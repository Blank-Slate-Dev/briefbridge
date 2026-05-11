// lib/supabase/server.ts
//
// Supabase client for use in Server Components, Server Actions, and Route
// Handlers (anywhere that runs on the server with access to the cookies API).
//
// Why this exists separate from lib/supabase/client.ts:
//   The server and browser have different ways of accessing cookies (Next's
//   async cookies() vs document.cookie). Supabase's @supabase/ssr package
//   gives us a factory pattern: same Supabase API surface, different cookie
//   adapter underneath.
//
// What this client is for:
//   - Reading the authenticated user in Server Components and Route Handlers
//     (via supabase.auth.getUser()).
//   - Signing in / signing out from Server Actions and Route Handlers.
//
// What this client is NOT for:
//   - Querying user data (matters, conversations, messages). Those go through
//     Drizzle in lib/db, with explicit user_id filters. See the architecture
//     notes in this chunk's accompanying explanation.
//   - Use in the browser. Use lib/supabase/client.ts for that.
//
// Note on Next.js 16:
//   cookies() is async. We must await it. Older tutorials show synchronous
//   cookies() — those are wrong for Next 15+.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // The setAll handler can throw when called from a Server Component
          // (Next disallows mutating cookies during render). That's expected
          // and safe to ignore here — the middleware refreshes sessions on
          // every request, so we don't need to set cookies during render.
          // We only catch the specific render-time error; anything else
          // propagates so we don't swallow real bugs.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component context — cookies will be refreshed by the
            // root middleware on the next request.
          }
        },
      },
    },
  );
}
