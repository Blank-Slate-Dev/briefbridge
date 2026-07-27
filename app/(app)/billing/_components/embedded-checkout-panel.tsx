// app/(app)/billing/_components/embedded-checkout-panel.tsx
//
// Stripe Embedded Checkout, mounted inside our own page.
//
// Card fields live in a Stripe-origin iframe, so card data never touches our
// infrastructure — but the user never leaves BriefBridge.
//
// =============================================================================
// WHY THE "SETTING UP" STATE EXISTS
// =============================================================================
//
// onComplete tells us the form was submitted. It does NOT mean we have
// granted access — the webhook writes the subscription row, and Stripe's own
// documentation warns that webhook delivery can be delayed. Between those two
// moments a user who was sent straight to the app would see a paywall
// seconds after paying, which is the single worst outcome on this page.
//
// So: hold an honest interim state, refresh the Server Component on a short
// interval, and let the parent swap us out once entitlement is real. If the
// webhook still hasn't landed after the timeout, say so plainly and reassure
// them the payment is safe rather than leaving a spinner running forever.
//
// The `interval` prop is part of the KEY on the provider: changing plan must
// fetch a NEW session, and remounting is the only way to make Stripe do that.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { createEmbeddedCheckoutAction } from '../_actions';
import { SUPPORT_EMAIL } from '@/lib/billing/copy';

// loadStripe returns a promise that must be created ONCE, outside the
// component — recreating it on render remounts the iframe.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
);

interface Props {
  interval: 'month' | 'year';
  /** Called on an interval until the parent re-renders with access granted. */
  onSubscribed: () => void;
}

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 25000;

export function EmbeddedCheckoutPanel({ interval, onSubscribed }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  // Stripe calls this to fetch the session. It must resolve to the secret
  // itself, not a wrapper object.
  const fetchClientSecret = useCallback(async () => {
    const result = await createEmbeddedCheckoutAction(interval);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    return result.clientSecret;
  }, [interval]);

  const handleComplete = useCallback(() => {
    setWaiting(true);
    const startedAt = Date.now();

    pollTimer.current = setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setSlow(true);
        return;
      }
      onSubscribed();
    }, POLL_INTERVAL_MS);
  }, [onSubscribed]);

  if (error) {
    return <p className="bb-account-error">{error}</p>;
  }

  if (waiting) {
    return (
      <div className="bb-account-waiting">
        <p className="bb-account-waiting-title">Setting up your account…</p>
        <p className="bb-account-card-help">
          Your payment went through. Confirming with Stripe now.
        </p>
        {slow && (
          <p className="bb-account-note">
            This is taking longer than usual. Your payment is safe and your
            trial has started — refresh in a moment, or email {SUPPORT_EMAIL}{' '}
            if it doesn&rsquo;t clear.
          </p>
        )}
      </div>
    );
  }

  return (
    <EmbeddedCheckoutProvider
      key={interval}
      stripe={stripePromise}
      options={{ fetchClientSecret, onComplete: handleComplete }}
    >
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}