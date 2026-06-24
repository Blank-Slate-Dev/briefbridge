// app/(app)/firm/page.tsx
//
// Firm management page (server component).
//
// Resolves the user's SHARED firm, fetches its members + pending invites, and
// hands them to the client component (invite form + lists).
//
// SINGLE-FIRM ASSUMPTION (revisit later): a user could eventually belong to
// multiple shared firms. For now we manage the FIRST non-personal firm they're
// a member of. When multi-shared-firm becomes real, add a firm picker.
//
// Access: middleware protects /firm (added to PROTECTED_PREFIXES). On top of
// that, if the user has no shared firm, we redirect to /matters — there's
// nothing to manage until they've upgraded.

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { getUserFirmMemberships } from '@/lib/db/queries/access';
import {
  listFirmMembers,
  listFirmInvitations,
} from '@/lib/db/queries/firm-invitations';
import { withUser } from '@/lib/db/with-user';
import { firms } from '@/lib/db/schema';
import { FirmPageClient } from './_components/firm-page-client';
import type { FirmRole } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function FirmPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/firm');
  }

  // Resolve the user's shared (non-personal) firm + their role in it.
  const memberships = await getUserFirmMemberships(user.id);
  const shared = memberships.find((m) => !m.isPersonal);
  if (!shared) {
    // No shared firm — nothing to manage.
    redirect('/matters');
  }

  const firmId = shared.firmId;
  const myRole: FirmRole = shared.role;
  const canManage = myRole === 'owner' || myRole === 'admin';

  // Fetch firm name, members, and pending invites in parallel.
  // The firm-name read goes through withUser so app.user_id is set for the
  // firms-table RLS policy (firms_select_sessvar). Without it, the policy
  // evaluates current_setting('app.user_id')::uuid against an empty string and
  // throws 22P02. listFirmInvitations already uses withUser; listFirmMembers
  // goes through a SECURITY DEFINER function that doesn't need the session var.
  const [firmNameRows, members, invitations] = await Promise.all([
    withUser(user.id, (tx) =>
      tx
        .select({ name: firms.name })
        .from(firms)
        .where(eq(firms.id, firmId))
        .limit(1),
    ),
    listFirmMembers(firmId),
    listFirmInvitations(user.id, firmId),
  ]);

  const firmName =
    firmNameRows.length > 0 ? firmNameRows[0].name : 'Your firm';

  return (
    <FirmPageClient
      firmId={firmId}
      firmName={firmName}
      myUserId={user.id}
      myRole={myRole}
      canManage={canManage}
      initialMembers={members}
      initialInvitations={invitations}
    />
  );
}