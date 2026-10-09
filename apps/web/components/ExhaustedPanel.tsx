'use client';

import { useState } from 'react';
import { MarqueeButton } from './cinema/MarqueeButton';
import { ReelLoader } from './cinema/ReelLoader';
import { Ticket } from './cinema/Ticket';

export function ExhaustedPanel({ isHost, onRestart }: { isHost: boolean; onRestart: () => Promise<void> }) {
  const [isLoading, setIsLoading] = useState(false);

  async function restart() {
    setIsLoading(true);
    await onRestart();
    setIsLoading(false);
  }

  return (
    <section className="py-8">
      <Ticket stub={<><span>End of reel</span><span>No match yet</span></>}>
        <h2 className="font-display text-5xl font-extrabold leading-none text-paper-ink">Intermission</h2>
        <p className="mt-2 text-paper-ink/70">Nobody liked the same movie in this batch. Grab a snack, then try the next reel.</p>
        <div className="mt-6">
          {isHost ? (
            <MarqueeButton type="button" tone="ink" onClick={restart} disabled={isLoading} className="w-full">
              {isLoading ? 'Loading…' : 'Load 20 more'}
            </MarqueeButton>
          ) : (
            <p className="flex items-center gap-3 text-paper-ink/70">
              <ReelLoader className="size-6" />
              Waiting for the host to load more movies…
            </p>
          )}
        </div>
      </Ticket>
    </section>
  );
}
