// app/(app)/matters/[id]/page.tsx
//
// Single-matter workspace.
//
// What changed in Chunk 3:
//   - Now server-fetches the matter via lib/db/queries/matters.ts
//   - Returns notFound() if the matter doesn't exist OR isn't owned by
//     the current user (the query handles both cases by returning null)
//   - Passes the real matter to MatterView via prop
//
// We still pass the matter to a Client Component because:
//   - The StatusMenu inside it needs to subscribe to MattersProvider
//   - Status changes propagate to the sidebar without a full refetch

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMatter } from '@/lib/db/queries/matters';
import { MatterView } from './_components/matter-view';

export const dynamic = 'force-dynamic';

export default async function MatterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/matters/${id}`);
  }

  // Fetch the matter, scoped to this user. The query returns null for both
  // "matter doesn't exist" and "matter exists but isn't yours" — we treat
  // both as 404 to avoid leaking the existence of other users' matters.
  const matter = await getMatter(user.id, id);
  if (!matter) {
    notFound();
  }

  return <MatterView matter={matter} />;
}
