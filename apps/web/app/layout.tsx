import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const marquee = Big_Shoulders({ subsets: ['latin'], variable: '--font-marquee', display: 'swap', adjustFontFallback: false });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Movie Night Matcher',
  description: 'Swipe through movies with friends. The first one everyone likes is what you watch tonight.',
};

export const viewport: Viewport = { themeColor: '#1b0b12' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${marquee.variable} ${body.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <div aria-hidden className="grain" />
        <div aria-hidden className="vignette" />
        <div className="relative flex-1">{children}</div>
        <footer className="relative px-4 py-6 text-center text-xs text-cream/45">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </body>
    </html>
  );
}
