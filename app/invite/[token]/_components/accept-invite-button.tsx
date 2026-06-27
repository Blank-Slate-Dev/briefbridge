// app/invite/[token]/_components/accept-invite-button.tsx
//
// Client button that accepts the invitation. Calls acceptInviteAction (server
// action), then on success shows a brief "Joined!" success state and redirects
// into the firm. On failure shows the reason inline.
//
// Three visual states:
//   idle      → "Accept invitation"
//   joining   → "Joining" + animated dots (request in flight)
//   joined    → "Joined!" (success flash before navigation completes)
//
// The joined state matters because router.push to /firm can take a couple of
// seconds; without it, the button would sit on "Joining…" looking frozen even
// though the accept already succeeded.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInviteAction } from '../../../_actions-invite';

type Phase = 'idle' | 'joining' | 'joined';

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'joining' || phase === 'joined';

  async function handleAccept() {
    if (busy) return;
    setError(null);
    setPhase('joining');
    try {
      const result = await acceptInviteAction(token);
      if (result.ok) {
        // Flash success, then navigate. Keep the button disabled throughout.
        setPhase('joined');
        router.push('/firm');
        router.refresh();
      } else {
        setError(result.error);
        setPhase('idle');
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setPhase('idle');
    }
  }

  return (
    <div className="bb-invite-accept">
      <button
        type="button"
        className="bb-invite-button"
        onClick={handleAccept}
        disabled={busy}
      >
        {phase === 'idle' && 'Accept invitation'}
        {phase === 'joining' && (
          <span className="bb-invite-joining">
            Joining
            <span className="bb-invite-dots" aria-hidden="true">
              <span className="bb-invite-dot" />
              <span className="bb-invite-dot" />
              <span className="bb-invite-dot" />
            </span>
          </span>
        )}
        {phase === 'joined' && 'Joined!'}
      </button>
      {error && <p className="bb-invite-error">{error}</p>}
    </div>
  );
}