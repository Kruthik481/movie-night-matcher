export type Option = { id: number; name: string };

export const GENRES: readonly Option[] = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 53, name: 'Thriller' },
  { id: 27, name: 'Horror' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 80, name: 'Crime' },
  { id: 16, name: 'Animation' },
  { id: 14, name: 'Fantasy' },
  { id: 10751, name: 'Family' },
  { id: 99, name: 'Documentary' },
];

export const LANGUAGES = [
  { code: '', name: 'Any language' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'ko', name: 'Korean' },
  { code: 'ja', name: 'Japanese' },
] as const;

/** TMDB watch-provider ids for region IN (verify with /watch/providers/movie?watch_region=IN). */
export const PROVIDERS: readonly Option[] = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 2336, name: 'JioHotstar' },
];
