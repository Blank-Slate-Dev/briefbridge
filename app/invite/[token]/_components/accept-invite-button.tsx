// app/invite/[token]/_components/accept-invite-button.tsx
//
// Client button that accepts the invitation. Calls acceptInviteAction (server
// action), then on success redirects into the firm. On failure shows the
// reason inline.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInviteAction } from '../../../_actions-invite';

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptInviteAction(token);
      if (result.ok) {
        // Joined — go to the firm page (now a member).
        router.push('/firm');
        router.refresh();
      } else {
        setError(result.error);
        setSubmitting(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="bb-invite-accept">
      <button
        type="button"
        className="bb-invite-button"
        onClick={handleAccept}
        disabled={submitting}
      >
        {submitting ? 'Joining…' : 'Accept invitation'}
      </button>
      {error && <p className="bb-invite-error">{error}</p>}
    </div>
  );
}