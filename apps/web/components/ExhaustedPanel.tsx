'use client';

import { useState } from 'react';

export function ExhaustedPanel({ isHost, onRestart }: { isHost: boolean; onRestart: () => Promise<void> }) {
  const [isLoading, setIsLoading] = useState(false);

  async function restart() {
    setIsLoading(true);
    await onRestart();
    setIsLoading(false);
  }

  return (
    <section className="space-y-4 py-16 text-center">
      <h2 className="text-2xl font-semibold">No match this round</h2>
      {isHost ? (
        <button
          type="button"
          onClick={restart}
          disabled={isLoading}
          className="rounded-lg bg-amber-400 px-6 py-2.5 font-medium text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {isLoading ? 'Loading…' : 'Load 20 more'}
        </button>
      ) : (
        <p className="text-zinc-400">Waiting for the host to load more movies…</p>
      )}
    </section>
  );
}
