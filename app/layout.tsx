// app/layout.tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono, Fraunces } from 'next/font/google';
import './globals.css';
import './_components/homepage.css';
import './(app)/matters/_components/matters.css';
import './(app)/matters/_components/status-menu.css';
import './(app)/_components/shell.css';
import './(app)/_components/sidebar-user-menu.css';

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

export const metadata: Metadata = {
  title: 'BriefBridge — The legal research partner for Australian lawyers',
  description:
    'Search Australian case law by what it means, not what it says. Grounded answers, verifiable citations, paragraph by paragraph.',
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
