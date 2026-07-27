// app/(app)/billing/_components/embedded-checkout-panel.tsx
//
// Stripe Embedded Checkout, mounted inside our own page.
//
// Card fields live in a Stripe-origin iframe, so card data never touches our
// infrastructure — but the user never leaves BriefBridge, which is the whole
// point of doing it this way rather than redirecting to the hosted page.
//
// ENTITLEMENT IS NOT GRANTED HERE. onComplete only tells us the form was
// submitted successfully. The webhook writes the subscription row, and it can
// land a second or two later, so this component POLLS for the row to appear
// before declaring success. That avoids the worst failure mode: telling
// someone they've subscribed and then showing them a paywall.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { createEmbeddedCheckoutAction } from '../_actions';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const DANGER = '#b4453a';

// loadStripe returns a promise that must be created ONCE, outside the
// component — recreating it on every render remounts the iframe.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
);

interface Props {
  /** Called once entitlement is confirmed in our own database. */
  onSubscribed: () => void;
}

// How long to wait for the webhook before giving up and telling the user to
// refresh. Generous: Stripe usually delivers in well under two seconds, but a
// cold serverless function on the first hit can add a little.
const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 25000;

export function EmbeddedCheckoutPanel({ onSubscribed }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  // Stripe calls this to fetch the session. It must return the secret itself,
  // not a wrapper object.
  const fetchClientSecret = useCallback(async () => {
    const result = await createEmbeddedCheckoutAction();
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    return result.clientSecret;
  }, []);

  // Payment form submitted. Now wait for the webhook to write our row.
  const handleComplete = useCallback(() => {
    setWaiting(true);
    const startedAt = Date.now();

    pollTimer.current = setInterval(async () => {
      // /api/health is not the right probe here — we need OUR entitlement
      // state, which the billing page re-reads on refresh. Ask the server
      // directly by re-rendering: a router refresh re-runs the page's
      // getAccessState. The parent decides what to show.
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setSlow(true);
        return;
      }
      onSubscribed();
    }, POLL_INTERVAL_MS);
  }, [onSubscribed]);

  if (error) {
    return (
      <p style={{ fontSize: 14, color: DANGER, margin: 0 }}>
        {error}
      </p>
    );
  }

  if (waiting) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif',
            fontSize: 20,
            color: NAVY,
            margin: '0 0 8px',
          }}
        >
          Setting up your account&hellip;
        </p>
        <p style={{ fontSize: 14, color: SOFT, margin: 0 }}>
          Your payment went through. Confirming with Stripe now.
        </p>
        {slow && (
          <p style={{ fontSize: 13, color: MUTED, margin: '14px 0 0' }}>
            This is taking longer than usual. Your payment is safe — refresh
            the page in a moment, or contact us if it doesn&rsquo;t clear.
          </p>
        )}
      </div>
    );
  }

  return (
    <div id="bb-embedded-checkout">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret, onComplete: handleComplete }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}