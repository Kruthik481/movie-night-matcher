import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { createTokenService } from '../src/rooms/token';
import { createServer } from '../src/server';
import { createTestPrisma, resetDb } from './helpers/db';
import { stubTmdb, TEST_JWT_SECRET } from './helpers/fakes';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const tokens = createTokenService(TEST_JWT_SECRET);
let app: FastifyInstance;
let tmdb: ReturnType<typeof stubTmdb>;

async function build(rateLimitMax = 100, movieRateLimitMax = 1000) {
  tmdb = stubTmdb();
  ({ app } = await createServer({
    prisma,
    tokens,
    tmdb,
    webOrigin: 'http://localhost:3000',
    region: 'IN',
    rateLimitMax,
    movieRateLimitMax,
  }));
}

beforeEach(async () => {
  await resetDb(prisma);
  await build();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe('GET /health', () => {
  it('responds ok', async () => {
    expect((await app.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });
});

describe('POST /rooms', () => {
  it('creates a room', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname: 'ana', filters: { genres: [28] } } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ code: expect.stringMatching(/^[A-Z2-9]{6}$/), token: expect.any(String) });
  });

  it('returns 400 with a readable message for bad input', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Nickname') });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('rate limits room creation', async () => {
    await app.close();
    await build(2);
    const create = () => app.inject({ method: 'POST', url: '/rooms', payload: { nickname: 'ana' } });
    await create();
    await create();
    const res = await create();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /rooms/:code/join', () => {
  it('joins with a lowercase code', async () => {
    const { code } = await seedRoom(prisma, { status: 'LOBBY' });
    const res = await app.inject({ method: 'POST', url: `/rooms/${code.toLowerCase()}/join`, payload: { nickname: 'cal' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ token: expect.any(String) });
  });

  it('maps service errors to status codes', async () => {
    const { code } = await seedRoom(prisma, { status: 'LOBBY' });
    const join = (c: string, nickname: string) =>
      app.inject({ method: 'POST', url: `/rooms/${c}/join`, payload: { nickname } });
    expect((await join('ZZZZZZ', 'x')).statusCode).toBe(404);
    expect((await join(code, 'ana')).statusCode).toBe(409);
    expect((await join('bad!', 'x')).statusCode).toBe(400);
  });
});

describe('GET /movies', () => {
  it('returns a movie card', async () => {
    const res = await app.inject({ url: '/movies/42' });
    expect(res.json()).toMatchObject({ id: 42, title: 'Movie 42' });
  });

  it('rate limits movie and provider lookups so a scan cannot burn the TMDB quota', async () => {
    await app.close();
    await build(100, 2);
    await app.inject({ url: '/movies/1' });
    await app.inject({ url: '/movies/2' });
    expect((await app.inject({ url: '/movies/2/providers' })).statusCode).toBe(200);
    const res = await app.inject({ url: '/movies/3' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('rejects a non-numeric id', async () => {
    expect((await app.inject({ url: '/movies/abc' })).statusCode).toBe(400);
  });

  it('passes TMDB failures through with their code', async () => {
    tmdb.movie.mockRejectedValueOnce(new AppError(502, 'TMDB_UNAVAILABLE', 'down'));
    const res = await app.inject({ url: '/movies/42' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('TMDB_UNAVAILABLE');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    tmdb.movie.mockRejectedValueOnce(new Error('secret stack detail'));
    const res = await app.inject({ url: '/movies/42' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('defaults providers to the configured region and validates overrides', async () => {
    await app.inject({ url: '/movies/42/providers' });
    expect(tmdb.providers).toHaveBeenCalledWith(42, 'IN');
    await app.inject({ url: '/movies/42/providers?region=US' });
    expect(tmdb.providers).toHaveBeenLastCalledWith(42, 'US');
    expect((await app.inject({ url: '/movies/42/providers?region=us' })).statusCode).toBe(400);
  });
});
