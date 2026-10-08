import type { Filters, MovieCard, Providers, ProviderView } from '@mnm/shared';
import { AppError } from '../errors';

const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const MIN_VOTE_COUNT = '20';

export type TmdbClient = {
  discover(filters: Filters, page: number): Promise<number[]>;
  movie(id: number): Promise<MovieCard>;
  providers(id: number, region: string): Promise<Providers>;
};

export type TmdbOptions = {
  apiKey: string;
  baseUrl: string;
  region: string;
  fetchFn?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  now?: () => number;
};

type RawProvider = { provider_id: number; provider_name: string; logo_path: string | null };
type RawRegionProviders = { link?: string; flatrate?: RawProvider[]; rent?: RawProvider[]; buy?: RawProvider[] };
type RawMovie = { id: number; title: string; release_date?: string; poster_path: string | null; overview?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toProvider = (p: RawProvider): ProviderView => ({
  id: p.provider_id,
  name: p.provider_name,
  logoUrl: p.logo_path ? `${IMAGE_BASE}/w92${p.logo_path}` : null,
});

export function createTmdbClient(opts: TmdbOptions): TmdbClient {
  const { apiKey, baseUrl, region, fetchFn = fetch, retries = 3, baseDelayMs = 200, now = Date.now } = opts;
  const cache = new Map<string, { at: number; value: unknown }>();

  async function fetchWithRetry<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let status = 0; // 0 = network error
      try {
        const res = await fetchFn(url);
        if (res.ok) return (await res.json()) as T;
        status = res.status;
      } catch {
        // network failure or unreadable body: fall through to the retry decision
      }
      if (status === 404) throw new AppError(404, 'MOVIE_NOT_FOUND', 'Movie not found');
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) {
        throw new AppError(502, 'TMDB_UNAVAILABLE', "Couldn't reach the movie database, try again");
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(baseUrl + path);
    url.searchParams.set('api_key', apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const cacheKey = url.toString();

    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value as T;

    const value = await fetchWithRetry<T>(cacheKey);
    // ponytail: wipe-on-full instead of LRU; swap in an LRU if the hit rate ever matters
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(cacheKey, { at: now(), value });
    return value;
  }

  return {
    async discover(filters, page) {
      const params: Record<string, string> = {
        sort_by: 'popularity.desc',
        include_adult: 'false',
        'vote_count.gte': MIN_VOTE_COUNT,
        watch_region: region,
        page: String(page),
      };
      if (filters.genres.length) params.with_genres = filters.genres.join('|');
      if (filters.language) params.with_original_language = filters.language;
      if (filters.providers.length) params.with_watch_providers = filters.providers.join('|');

      const data = await get<{ results: { id: number }[] }>('/discover/movie', params);
      return [...new Set(data.results.map((r) => r.id))];
    },

    async movie(id) {
      const raw = await get<RawMovie>(`/movie/${id}`);
      return {
        id: raw.id,
        title: raw.title,
        year: raw.release_date ? Number(raw.release_date.slice(0, 4)) : null,
        posterUrl: raw.poster_path ? `${IMAGE_BASE}/w500${raw.poster_path}` : null,
        overview: raw.overview ?? '',
      };
    },

    async providers(id, regionCode) {
      const data = await get<{ results: Record<string, RawRegionProviders> }>(`/movie/${id}/watch/providers`);
      const entry = data.results[regionCode];
      return {
        link: entry?.link ?? null,
        flatrate: (entry?.flatrate ?? []).map(toProvider),
        rent: (entry?.rent ?? []).map(toProvider),
        buy: (entry?.buy ?? []).map(toProvider),
      };
    },
  };
}
