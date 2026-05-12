// app/login/_components/login-form.tsx
//
// Client component for the login UI: title, subtitle, Google button,
// divider, and email/password form.
//
// Why everything-in-one-component:
//   The title + subtitle re-render when the user toggles between sign-in
//   and sign-up modes. Keeping them in this client component means a
//   single mode state drives every part of the UI that depends on it.
//
// Height stability (the "flick between sign in / sign up smoothly" goal):
//   The hint row under the password field is rendered in BOTH modes:
//     - sign in: "Forgot password?" link
//     - sign up: "At least 8 characters" reminder
//   This guarantees the card is exactly the same height in both states,
//   so toggling feels like a content swap rather than a layout shift.
//   The submit button also has a fixed min-width via CSS so the label
//   change ("Sign in" → "Create account") doesn't snap the button width.

'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInAction, signUpAction } from './actions';
import { GoogleButton } from './google-button';

type Mode = 'signin' | 'signup';

interface LoginFormProps {
  /** Initial mode — controlled by URL param ?mode=signup, falls back to signin. */
  initialMode?: Mode;
}

export function LoginForm({ initialMode = 'signin' }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // useTransition gives us a `pending` flag we can use to disable the button
  // and show loading state during the server action. It's the React-blessed
  // way to track server action status without a separate isLoading state.
  const [isPending, startTransition] = useTransition();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);

  // Where to send the user after successful sign-in.
  // The middleware preserves their original destination via ?next=.
  // If no next param (or it's unsafe), default to /matters as the home.
  function postSignInDestination(): string {
    const next = searchParams.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
      return next;
    }
    return '/matters';
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSignupSuccess(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      if (mode === 'signin') {
        const result = await signInAction(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Sign-in succeeded; Supabase has set the auth cookies.
        // router.refresh() is critical here — it tells Next.js to re-fetch
        // the current route's server data, which causes the middleware to
        // run again with the new session and the redirect-from-/login logic
        // to fire. router.push() alone would navigate, but the server-side
        // session state wouldn't be re-evaluated.
        router.push(postSignInDestination());
        router.refresh();
      } else {
        const result = await signUpAction(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Sign-up succeeded but the user needs to confirm their email
        // before they can sign in. Show a friendly inline confirmation.
        const submittedEmail = String(formData.get('email') ?? '').trim();
        setSignupSuccess(
          `We've sent a confirmation link to ${submittedEmail}. Click it to activate your account.`,
        );
      }
    });
  }

  function toggleMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
    setSignupSuccess(null);
  }

  return (
    <>
      {/* Title + subtitle: re-render with mode. */}
      <h1 className="bb-login-title">
        {mode === 'signin' ? (
          <>
            Welcome <em>back</em>
          </>
        ) : (
          <>
            Get <em>started</em>
          </>
        )}
      </h1>

      <p className="bb-login-sub">
        {mode === 'signin'
          ? 'Sign in to your BriefBridge workspace.'
          : 'Create your BriefBridge workspace.'}
      </p>

      <div className="bb-login-google-wrap">
        <GoogleButton />
      </div>

      <div className="bb-login-divider">
        <span>or with email</span>
      </div>

      <form onSubmit={handleSubmit} className="bb-login-form" noValidate>
        <div className="bb-login-field">
          <label htmlFor="email" className="bb-login-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={isPending || signupSuccess !== null}
            className="bb-login-input"
            placeholder="you@firm.com.au"
          />
        </div>

        <div className="bb-login-field">
          <label htmlFor="password" className="bb-login-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            disabled={isPending || signupSuccess !== null}
            className="bb-login-input"
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            minLength={mode === 'signup' ? 8 : undefined}
          />

          {/*
            Hint row — ALWAYS rendered, content switches by mode.
            This guarantees the card is the same height in both states so
            toggling between sign in / sign up feels like a content swap,
            not a layout jump.

            We use .bb-login-hint-row-spread to push the password rules to
            the left and the Forgot Password link to the right (when both
            could be present in future). Today only one shows at a time.
          */}
          <div className="bb-login-hint-row">
            {mode === 'signin' ? (
              <a href="#forgot-password" className="bb-login-link">
                Forgot password?
              </a>
            ) : (
              <span className="bb-login-hint-text">
                At least 8 characters
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="bb-login-error" role="alert">
            {error}
          </div>
        )}

        {signupSuccess && (
          <div className="bb-login-success" role="status">
            {signupSuccess}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || signupSuccess !== null}
          className="bb-login-submit"
        >
          {isPending
            ? mode === 'signin'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>

        <p className="bb-login-toggle">
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="bb-login-link"
                onClick={toggleMode}
                disabled={isPending}
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className="bb-login-link"
                onClick={toggleMode}
                disabled={isPending}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </>
  );
}
