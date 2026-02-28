import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google';

import { AuthProvider } from '@/lib/auth-context';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-ibm-plex-sans',
  weight: ['400', '500', '600', '700'],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Onboarding Hub — Tracks, assessments, and much more',
  description: 'Internal platform: onboarding hub, tracks, assessments, progress, and role readiness.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body className={`${ibmPlexSans.variable} ${spaceGrotesk.variable} min-h-screen`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
