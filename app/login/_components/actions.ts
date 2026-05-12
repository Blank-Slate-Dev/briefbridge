// app/login/_components/actions.ts
//
// Server actions for sign-in and sign-up.
//
// Why server actions and not API routes:
//   - Server actions run on the server with direct access to the Supabase
//     server client (which can set auth cookies via Next's cookies() API).
//   - The client component (login-form.tsx) invokes these directly without
//     building fetch() calls and parsing responses — less code, fewer error
//     paths to handle.
//
// Why these are in _components/ (underscore prefix):
//   Next.js treats directories starting with _ as "private folders" — they
//   never become routes regardless of their contents. So _components is a
//   safe place to put files that should be co-located with the route but
//   shouldn't be exposed as URLs.
//
// Both actions return a discriminated union of success/error rather than
// throwing or redirecting. This is intentional:
//   - Form errors (wrong password, email taken) are not exceptions — they're
//     part of the normal flow and the UI needs to display them inline.
//   - Redirect is the caller's responsibility, not the action's. This keeps
//     the action testable in isolation and keeps the form in charge of UX.

'use server';

import { createClient } from '@/lib/supabase/server';

// =============================================================================
// Result types
// =============================================================================

export type AuthResult =
  | { ok: true }
  | { ok: false; error: string };

export type SignUpResult =
  | { ok: true; needsConfirmation: true }
  | { ok: false; error: string };

// =============================================================================
// Validation — lightweight, defensive
//
// Supabase will also validate these on its end. We do client-friendly
// validation here so the user gets a useful error message faster than a
// round trip to Supabase would provide.
// =============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string') return 'Email is required.';
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'Email is required.';
  if (trimmed.length > 320) return 'Email is too long.';
  if (!EMAIL_REGEX.test(trimmed)) return 'That doesn\'t look like a valid email.';
  return null;
}

function validatePassword(password: unknown, requireStrong = false): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length === 0) return 'Password is required.';
  // Supabase's default minimum is 6 characters. For sign-up we require a
  // bit more for sanity (8+); for sign-in we just require non-empty since
  // we don't want to lock out users whose old password was 6 chars.
  if (requireStrong && password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 72) {
    // bcrypt's hard limit. Supabase truncates silently, which can cause
    // confusing "wrong password" errors later. Reject early.
    return 'Password is too long (max 72 characters).';
  }
  return null;
}

// =============================================================================
// Sign in with email + password
// =============================================================================

export async function signInAction(formData: FormData): Promise<AuthResult> {
  const email = formData.get('email');
  const password = formData.get('password');

  const emailError = validateEmail(email);
  if (emailError) return { ok: false, error: emailError };

  const passwordError = validatePassword(password, false);
  if (passwordError) return { ok: false, error: passwordError };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: (email as string).trim(),
    password: password as string,
  });

  if (error) {
    // Don't leak whether the email exists. Supabase returns "Invalid login
    // credentials" for both wrong-password and no-such-user, which is the
    // right default. We pass that through.
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// =============================================================================
// Sign up with email + password
//
// Because email confirmation is required (set in the Supabase dashboard),
// signUp() does NOT immediately create a session. The user gets an email,
// clicks the link, and only THEN are they signed in.
//
// We surface this via the `needsConfirmation: true` flag so the UI can show
// a "Check your email" message instead of redirecting to /matters.
// =============================================================================

export async function signUpAction(formData: FormData): Promise<SignUpResult> {
  const email = formData.get('email');
  const password = formData.get('password');

  const emailError = validateEmail(email);
  if (emailError) return { ok: false, error: emailError };

  const passwordError = validatePassword(password, true);
  if (passwordError) return { ok: false, error: passwordError };

  const supabase = await createClient();

  // The `emailRedirectTo` URL is where Supabase will send the user after
  // they click the confirmation link in their email. It must be on the
  // Supabase Redirect URLs allowlist (we set this up in the dashboard:
  // http://localhost:3000/auth/callback).
  //
  // For production, we'll need to read this from an env var instead of
  // hardcoding localhost — TODO when we deploy.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const { error } = await supabase.auth.signUp({
    email: (email as string).trim(),
    password: password as string,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, needsConfirmation: true };
}
