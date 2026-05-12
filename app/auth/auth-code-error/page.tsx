// app/auth/auth-code-error/page.tsx
//
// Error page for when the OAuth or email-confirmation code exchange fails.
//
// Reasons this page might be reached:
//   - User denied the OAuth consent at Google
//   - Confirmation email link expired (default 24h)
//   - User refreshed the callback URL after the code was already consumed
//   - Misconfiguration (e.g. mismatched redirect URL on Supabase or Google)
//
// We surface the underlying reason where available so it's debuggable, and
// give the user a clear path back to /login.

import Link from 'next/link';
import '../../login/login.css';

interface AuthCodeErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AuthCodeErrorPage({
  searchParams,
}: AuthCodeErrorPageProps) {
  const params = await searchParams;
  const reason = params.reason;

  return (
    <main className="bb-login-page">
      <div className="bb-login-card">
        <h1 className="bb-login-title">
          Something <em>went wrong</em>
        </h1>
        <p className="bb-login-sub">
          We couldn&apos;t complete your sign-in. This usually happens when
          a link has expired or been used already.
        </p>

        {reason && (
          <div className="bb-login-error" role="alert">
            <strong>Details:</strong> {reason}
          </div>
        )}

        <Link href="/login" className="bb-login-submit bb-login-submit-link">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
