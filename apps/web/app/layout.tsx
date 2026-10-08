import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Movie Night Matcher',
  description: 'Swipe together. The first movie everyone likes wins.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100 antialiased">
        <div className="flex-1">{children}</div>
        <footer className="px-4 py-6 text-center text-xs text-zinc-500">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </body>
    </html>
  );
}
