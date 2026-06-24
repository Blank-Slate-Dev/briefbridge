// app/_actions-invite.ts
//
// Server action for accepting a firm invitation. Lives at the top level (not
// in the (app) group) because the invite page is a standalone route outside
// the app shell.
//
// 'use server' — only async exports.

'use server';

import { createClient } from '@/lib/supabase/server';
import { acceptInvitation } from '@/lib/db/queries/firm-invitations';

type ActionResult =
  | { ok: true; firmId: string }
  | { ok: false; error: string };

/**
 * Accepts the invitation identified by token, for the currently signed-in user.
 * Calls acceptInvitation, which runs the accept_firm_invitation SECURITY
 * DEFINER function (validates token + email + expiry, inserts the membership,
 * marks the invite accepted).
 *
 * Maps the function's failure reasons to friendly messages.
 */
export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'You need to be signed in to accept.' };
  }

  const email = user.email ?? '';
  const result = await acceptInvitation(user.id, email, token);

  if (result.ok) {
    return { ok: true, firmId: result.firmId };
  }

  switch (result.reason) {
    case 'not_found':
      return { ok: false, error: 'This invitation is no longer valid.' };
    case 'expired':
      return { ok: false, error: 'This invitation has expired.' };
    case 'email_mismatch':
      return {
        ok: false,
        error: 'This invitation was sent to a different email address.',
      };
    default:
      return { ok: false, error: 'Could not accept the invitation.' };
  }
}