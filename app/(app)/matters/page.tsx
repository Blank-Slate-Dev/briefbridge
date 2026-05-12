// app/(app)/matters/page.tsx
//
// Real matters list. Server-fetches matters via lib/db/queries/matters.ts
// and hands them to a Client Component for live editing.
//
// What changed in Chunk 3:
//   - This is now a Server Component (no 'use client'). It fetches the
//     current user's matters via Drizzle and passes them down.
//   - The "Preview UI" mock banner is gone.
//   - A real empty state ("No cases yet — create your first") replaces
//     the mock data flow when the user has no matters.
//   - The "+ New case" button now invokes a server action.
//
// The MattersProvider lives in the (app) layout, not here — that's because
// the sidebar (which also reads matters) is in the layout. The layout now
// also server-fetches the matters list to seed the provider.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listMattersForUser } from '@/lib/db/queries/matters';
import { MattersPageClient } from './_components/matters-page-client';

// Force dynamic rendering — this page is per-user, can't be statically
// cached. Without this, Next.js might attempt to prerender it during build
// and fail because there's no authenticated user at build time.
export const dynamic = 'force-dynamic';

export default async function MattersPage() {
  // Authentication. The middleware should have already gated this route,
  // but we defensively redirect if somehow we got here unauthenticated.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/matters');
  }

  // Fetch the user's matters. Excludes archived (the default).
  const matters = await listMattersForUser(user.id);

  return <MattersPageClient matters={matters} />;
}
