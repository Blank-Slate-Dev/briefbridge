// lib/supabase/client.ts
//
// Supabase client for use in Client Components (browser-side).
//
// Why this exists separate from lib/supabase/server.ts:
//   The browser uses document.cookie, not Next's cookies() API. @supabase/ssr
//   handles the difference via two factory functions; we use the browser one
//   here.
//
// What this client is for:
//   - Triggering sign-in flows from a Client Component (OAuth popups,
//     email/password forms) where we want the auth state change to be
//     immediately reflected in the same page without a full reload.
//   - Subscribing to auth state changes (rare; we mostly let the server
//     re-render handle it).
//
// What this client is NOT for:
//   - Reading the authoritative user identity for authorization decisions.
//     Always do that on the server via lib/supabase/server.ts. The browser
//     client can be tampered with by a malicious page; the server client
//     (which validates the JWT against Supabase) cannot.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
