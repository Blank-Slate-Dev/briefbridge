// app/invite/[token]/page.tsx
//
// Invite accept page (standalone — NOT in the (app) group, so no sidebar/shell).
// Path 1 (signed-in accept): if the user isn't signed in, we bounce to /login
// with ?next back to this invite, so they return here after signing in. (The
// signed-out new-user signup→accept path is deliberately not built yet.)
//
// Flow:
//   - resolve token + signed-in user's email via get_invitation_for_accept
//   - decide what to show: valid invite → accept screen; otherwise an error
//     (wrong email / expired / revoked / accepted / not found)
//
// Middleware does NOT protect /invite (not in PROTECTED_PREFIXES), so a
// signed-out visitor reaches this page; we redirect them to login ourselves.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getInvitationForAccept } from '@/lib/db/queries/firm-invitations';
import { AcceptInviteButton } from './_components/accept-invite-button';
import './invite.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

function roleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'lawyer':
      return 'Lawyer';
    case 'paralegal':
      return 'Paralegal';
    default:
      return role;
  }
}

export default async function InviteAcceptPage({ params }: PageProps) {
  const { token } = await params;

  // Auth — path 1 requires sign-in. Bounce to login, returning here after.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/invite/${token}`);
  }

  const email = user.email ?? '';
  const invite = await getInvitationForAccept(token, email);

  // Decide what to render.
  let body: React.ReactNode;

  if (!invite) {
    body = (
      <InviteMessage
        title="Invitation not found"
        message="This invitation link is invalid or no longer exists."
      />
    );
  } else if (!invite.emailMatches) {
    body = (
      <InviteMessage
        title="Wrong account"
        message={`This invitation was sent to a different email address. You're signed in as ${email}. Sign in with the invited email to accept.`}
      />
    );
  } else if (invite.status === 'accepted') {
    body = (
      <InviteMessage
        title="Already accepted"
        message={`You've already joined ${invite.firmName}.`}
        cta={{ href: '/firm', label: 'Go to firm' }}
      />
    );
  } else if (invite.status === 'revoked') {
    body = (
      <InviteMessage
        title="Invitation revoked"
        message="This invitation has been revoked by the firm."
      />
    );
  } else if (invite.status === 'expired' || invite.expired) {
    body = (
      <InviteMessage
        title="Invitation expired"
        message="This invitation has expired. Ask the firm to send a new one."
      />
    );
  } else {
    // Valid, pending, email matches → the accept screen.
    body = (
      <div className="bb-invite-card">
        <p className="bb-invite-eyebrow">You've been invited</p>
        <h1 className="bb-invite-firm">{invite.firmName}</h1>
        <p className="bb-invite-detail">
          Join as <strong>{roleLabel(invite.role)}</strong>
        </p>
        <AcceptInviteButton token={token} />
        <p className="bb-invite-signedin">Signed in as {email}</p>
      </div>
    );
  }

  return (
    <main className="bb-invite-page">
      <div className="bb-invite-brand">BriefBridge</div>
      {body}
    </main>
  );
}

function InviteMessage({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="bb-invite-card">
      <h1 className="bb-invite-firm bb-invite-firm-small">{title}</h1>
      <p className="bb-invite-detail">{message}</p>
      {cta && (
        <a href={cta.href} className="bb-invite-button bb-invite-button-link">
          {cta.label}
        </a>
      )}
    </div>
  );
}