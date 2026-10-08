import type { ReactNode } from 'react';
import { ReelLoader } from './cinema/ReelLoader';

export function Notice({ title, children, isLoading = false }: { title: string; children?: ReactNode; isLoading?: boolean }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-28 text-center">
      {isLoading && <ReelLoader />}
      <h1 className="font-display text-5xl font-extrabold text-tungsten">{title}</h1>
      {children}
    </main>
  );
}
