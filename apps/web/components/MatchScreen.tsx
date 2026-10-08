'use client';

import type { ProviderView, Providers } from '@mnm/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MovieCardView } from './MovieCardView';

export function MatchScreen({ movieId }: { movieId: number }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isLive = true;
    api.providers(movieId, 'IN').then(
      (data) => isLive && setProviders(data),
      () => isLive && setHasFailed(true),
    );
    return () => {
      isLive = false;
    };
  }, [movieId]);

  const isEmpty = providers && !providers.flatrate.length && !providers.rent.length && !providers.buy.length;

  return (
    <section className="space-y-6 text-center">
      <h2 className="text-3xl font-semibold text-amber-400">{"It's a match!"}</h2>
      <div className="mx-auto max-w-sm">
        <MovieCardView movieId={movieId} />
      </div>
      {hasFailed && <p className="text-sm text-zinc-400">{"Couldn't load where it's streaming."}</p>}
      {isEmpty && <p className="text-sm text-zinc-400">Not streaming in India right now.</p>}
      {providers && (
        <div className="space-y-4">
          <ProviderList title="Stream on" items={providers.flatrate} />
          <ProviderList title="Rent" items={providers.rent} />
          <ProviderList title="Buy" items={providers.buy} />
          {providers.link && (
            <a href={providers.link} target="_blank" rel="noreferrer" className="inline-block text-sm text-amber-400 hover:underline">
              All watch options
            </a>
          )}
          <p className="text-xs text-zinc-500">Streaming data by JustWatch</p>
        </div>
      )}
    </section>
  );
}

function ProviderList({ title, items }: { title: string; items: ProviderView[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm text-zinc-400">{title}</h3>
      <ul className="flex flex-wrap justify-center gap-3">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm">
            {p.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- tiny TMDB logo
              <img src={p.logoUrl} alt="" className="size-6 rounded" />
            )}
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
