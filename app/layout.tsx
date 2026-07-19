// app/layout.tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono, Fraunces } from 'next/font/google';
import './globals.css';
import './_components/homepage.css';
import './(app)/matters/_components/matters.css';
import './(app)/matters/_components/matters-legislation.css';
import './(app)/matters/_components/status-menu.css';
import './(app)/_components/shell.css';
import './(app)/_components/sidebar-user-menu.css';
import './(public)/cases/_components/cases.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  // Variable font axes — opsz lets us shift to display optical sizing on
  // large headlines for that crisp editorial feel
  axes: ['opsz'],
});

// SEO foundation:
//   - metadataBase makes every relative canonical/OG URL resolve absolutely
//     against the production domain (required for correct og:url etc).
//   - title.template gives child pages "Page name — BriefBridge" for free;
//     child pages just export `title: 'Page name'`.
//   - openGraph/twitter defaults mean every page has share metadata even
//     before a page-specific override exists.
export const metadata: Metadata = {
  metadataBase: new URL('https://briefbridge.ai'),
  title: {
    default: 'BriefBridge | The legal research partner for Australian lawyers',
    template: '%s — BriefBridge',
  },
  description:
    'Search Australian case law by what it means, not what it says. Grounded answers, verifiable citations, paragraph by paragraph.',
  openGraph: {
    type: 'website',
    siteName: 'BriefBridge',
    url: 'https://briefbridge.ai',
    title: 'BriefBridge | The legal research partner for Australian lawyers',
    description:
      'Search Australian case law by what it means, not what it says. Grounded answers, verifiable citations, paragraph by paragraph.',
    images: [{ url: '/logo.png', width: 1024, height: 237, alt: 'BriefBridge' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BriefBridge | The legal research partner for Australian lawyers',
    description:
      'Search Australian case law by what it means, not what it says. Grounded answers, verifiable citations, paragraph by paragraph.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
