// app/login/page.tsx
//
// Login page. Server Component so we can:
//   - Read the ?mode= search param to set the form's initial mode
//   - Render the brand mark with next/image
//   - Keep the form-handling logic isolated in a smaller client component
//
// Layout:
//   Centered card on the cream background, classic SaaS pattern.
//
// Why title + subtitle live INSIDE the client form (not in this server page):
//   They depend on the form's mode state. The mode toggles client-side when
//   the user clicks "Create one" / "Sign in" inside the form. If the title
//   lived here (server component), it would render once with the initial
//   mode and then NEVER update when the user toggled — leading to a stale
//   "Welcome back" header showing above a sign-up form. So we move both
//   into the client component where they can re-render with state changes.
//
// The (lack of) auth check:
//   We don't need to check "is the user already signed in?" here because
//   the middleware already redirects authenticated users away from /login
//   before they ever reach this page.

import Image from 'next/image';
import Link from 'next/link';
import { LoginForm } from './_components/login-form';
import { GoogleButton } from './_components/google-button';
import './login.css';

// Both pages and search params are async in Next 16; we await them.
interface LoginPageProps {
  searchParams: Promise<{
    mode?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const initialMode = params.mode === 'signup' ? 'signup' : 'signin';

  return (
    <main className="bb-login-page">
      <div className="bb-login-card">
        <Link
          href="/"
          className="bb-login-brand"
          aria-label="BriefBridge home"
        >
          <Image
            src="/logo.png"
            alt="BriefBridge"
            width={173}
            height={40}
            className="bb-login-logo"
            priority
          />
        </Link>

        {/*
          The title, subtitle, Google button, divider, and form ALL live
          inside <LoginForm> so they share a single source of truth for
          the current mode (signin vs signup). When the user clicks the
          "Create one" / "Sign in" link, every piece that depends on mode
          re-renders together.
        */}
        <LoginForm initialMode={initialMode} />
      </div>

      <p className="bb-login-footer-note">
        By continuing, you agree to BriefBridge&apos;s{' '}
        <Link href="#">Terms</Link> and{' '}
        <Link href="#">Privacy Policy</Link>.
      </p>
    </main>
  );
}
