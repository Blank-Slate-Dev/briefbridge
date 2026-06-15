// middleware.ts
//
// Root middleware — runs on every request matching the `matcher` config.
// Currently delegates entirely to the Supabase session helper, which:
//   - Refreshes the auth session if needed
//   - Redirects unauthenticated users away from protected routes
//   - Redirects authenticated users away from /login
//
// The matcher is intentionally broad (excludes only static assets) because
// we need session refresh to happen even on public pages — otherwise a user
// browsing /cases while their JWT expires would silently lose their session
// without us noticing until they navigate to /matters.

import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *   - _next/static (build output)
     *   - _next/image  (image optimization)
     *   - favicon.ico
     *   - public asset extensions
     *
     * Note: we DO match API routes and dynamic pages — every other request
     * gets a session-refresh pass.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};