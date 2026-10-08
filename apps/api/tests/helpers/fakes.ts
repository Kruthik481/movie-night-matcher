import type { Filters, MovieCard, Providers } from '@mnm/shared';
import { vi } from 'vitest';
import type { TmdbClient } from '../../src/tmdb/client';

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret!';

export function stubTmdb(decks: number[][] = [[11, 22, 33]]) {
  return {
    discover: vi.fn(async (_filters: Filters, page: number) => decks[page - 1] ?? []),
    movie: vi.fn(async (id: number): Promise<MovieCard> => ({
      id,
      title: `Movie ${id}`,
      year: 2024,
      posterUrl: null,
      overview: '',
    })),
    providers: vi.fn(async (_id: number, _region: string): Promise<Providers> => ({
      link: null,
      flatrate: [],
      rent: [],
      buy: [],
    })),
  } satisfies TmdbClient;
}
