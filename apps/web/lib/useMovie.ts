'use client';

import type { MovieCard } from '@mnm/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

const cache = new Map<number, Promise<MovieCard>>();

export function fetchMovie(id: number): Promise<MovieCard> {
  const cached = cache.get(id);
  if (cached) return cached;
  const pending = api.movie(id);
  cache.set(id, pending);
  pending.catch(() => cache.delete(id)); // let a later render retry
  return pending;
}

type Result = { id: number; movie: MovieCard | null; failed: boolean };

export function useMovie(id: number): { movie: MovieCard | null; failed: boolean } {
  const [result, setResult] = useState<Result>({ id, movie: null, failed: false });

  useEffect(() => {
    let isLive = true;
    fetchMovie(id).then(
      (movie) => isLive && setResult({ id, movie, failed: false }),
      () => isLive && setResult({ id, movie: null, failed: true }),
    );
    return () => {
      isLive = false;
    };
  }, [id]);

  return result.id === id ? result : { movie: null, failed: false };
}
