import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const valid = {
  DATABASE_URL: 'postgresql://mnm:mnm@localhost:5433/mnm',
  TMDB_API_KEY: 'key',
  JWT_SECRET: 'x'.repeat(32),
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      TMDB_BASE_URL: 'https://api.themoviedb.org/3',
      TMDB_REGION: 'IN',
      PORT: 4000,
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast naming every missing or invalid variable', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short', TMDB_API_KEY: undefined })).toThrow(
      /JWT_SECRET[\s\S]*TMDB_API_KEY|TMDB_API_KEY[\s\S]*JWT_SECRET/,
    );
  });

  it('rejects a WEB_ORIGIN that is not a URL', () => {
    expect(() => loadEnv({ ...valid, WEB_ORIGIN: 'localhost' })).toThrow(/WEB_ORIGIN/);
  });
});
