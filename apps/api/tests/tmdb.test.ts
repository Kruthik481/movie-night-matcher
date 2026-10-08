import { describe, expect, it, vi } from 'vitest';
import { createTmdbClient } from '../src/tmdb/client';

type Reply = { status?: number; body?: unknown } | Error;

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies];
  return vi.fn(async (_url: string | URL | Request) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  });
}

function client(fetchFn: ReturnType<typeof fakeFetch>, now = () => 0) {
  return createTmdbClient({
    apiKey: 'k',
    baseUrl: 'https://tmdb.test/3',
    region: 'IN',
    fetchFn: fetchFn as unknown as typeof fetch,
    baseDelayMs: 0,
    now,
  });
}

const calledUrl = (fn: ReturnType<typeof fakeFetch>, call = 0) => new URL(String(fn.mock.calls[call]![0]));

describe('discover', () => {
  it('builds the discover query from filters and page', async () => {
    const fetchFn = fakeFetch({ body: { results: [{ id: 1 }] } });
    await client(fetchFn).discover({ genres: [28, 35], language: 'hi', providers: [8, 119] }, 2);
    const url = calledUrl(fetchFn);
    expect(url.pathname).toBe('/3/discover/movie');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      api_key: 'k',
      with_genres: '28|35',
      with_original_language: 'hi',
      with_watch_providers: '8|119',
      watch_region: 'IN',
      page: '2',
      include_adult: 'false',
    });
  });

  it('omits empty filters', async () => {
    const fetchFn = fakeFetch({ body: { results: [] } });
    await client(fetchFn).discover({ genres: [], providers: [] }, 1);
    const params = calledUrl(fetchFn).searchParams;
    expect(params.has('with_genres')).toBe(false);
    expect(params.has('with_original_language')).toBe(false);
    expect(params.has('with_watch_providers')).toBe(false);
  });

  it('deduplicates ids while keeping order', async () => {
    const fetchFn = fakeFetch({ body: { results: [{ id: 3 }, { id: 1 }, { id: 3 }, { id: 2 }] } });
    expect(await client(fetchFn).discover({ genres: [], providers: [] }, 1)).toEqual([3, 1, 2]);
  });
});

describe('movie', () => {
  it('maps details into a card', async () => {
    const fetchFn = fakeFetch({
      body: { id: 7, title: 'Drishyam', release_date: '2015-07-31', poster_path: '/p.jpg', overview: 'o' },
    });
    expect(await client(fetchFn).movie(7)).toEqual({
      id: 7,
      title: 'Drishyam',
      year: 2015,
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      overview: 'o',
    });
  });

  it('tolerates a missing release date, poster and overview', async () => {
    const fetchFn = fakeFetch({ body: { id: 7, title: 'X', release_date: '', poster_path: null } });
    expect(await client(fetchFn).movie(7)).toMatchObject({ year: null, posterUrl: null, overview: '' });
  });

  it('maps a TMDB 404 without retrying', async () => {
    const fetchFn = fakeFetch({ status: 404 });
    await expect(client(fetchFn).movie(7)).rejects.toMatchObject({ status: 404, code: 'MOVIE_NOT_FOUND' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('providers', () => {
  it('maps the requested region', async () => {
    const fetchFn = fakeFetch({
      body: {
        results: {
          IN: {
            link: 'https://tmdb/watch',
            flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
            rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: null }],
          },
        },
      },
    });
    expect(await client(fetchFn).providers(7, 'IN')).toEqual({
      link: 'https://tmdb/watch',
      flatrate: [{ id: 8, name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/n.png' }],
      rent: [{ id: 2, name: 'Apple TV', logoUrl: null }],
      buy: [],
    });
  });

  it('returns empty lists when the region is absent', async () => {
    const fetchFn = fakeFetch({ body: { results: {} } });
    expect(await client(fetchFn).providers(7, 'IN')).toEqual({ link: null, flatrate: [], rent: [], buy: [] });
  });
});

describe('resilience', () => {
  it('retries 5xx and network errors, then succeeds', async () => {
    const fetchFn = fakeFetch({ status: 503 }, new TypeError('fetch failed'), { body: { results: [{ id: 1 }] } });
    expect(await client(fetchFn).discover({ genres: [], providers: [] }, 1)).toEqual([1]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 retries with TMDB_UNAVAILABLE', async () => {
    const fetchFn = fakeFetch({ status: 429 });
    await expect(client(fetchFn).discover({ genres: [], providers: [] }, 1)).rejects.toMatchObject({
      status: 502,
      code: 'TMDB_UNAVAILABLE',
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('does not retry other 4xx responses', async () => {
    const fetchFn = fakeFetch({ status: 401 });
    await expect(client(fetchFn).movie(1)).rejects.toMatchObject({ status: 502 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('cache', () => {
  it('serves repeats from memory until the TTL passes', async () => {
    let time = 0;
    const fetchFn = fakeFetch({ body: { id: 1, title: 'A', release_date: '2020-01-01', poster_path: null, overview: '' } });
    const tmdb = client(fetchFn, () => time);
    await tmdb.movie(1);
    await tmdb.movie(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    time += 6 * 60 * 60 * 1000;
    await tmdb.movie(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const fetchFn = fakeFetch({ status: 404 }, { body: { id: 1, title: 'A', release_date: '', poster_path: null } });
    const tmdb = client(fetchFn);
    await expect(tmdb.movie(1)).rejects.toMatchObject({ status: 404 });
    await expect(tmdb.movie(1)).resolves.toMatchObject({ title: 'A' });
  });
});
