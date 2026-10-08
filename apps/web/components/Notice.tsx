import type { ReactNode } from 'react';

export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
