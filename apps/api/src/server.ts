import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { CreateRoomBodySchema, JoinRoomBodySchema, RegionSchema, RoomCodeSchema } from '@mnm/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import type { PrismaClient } from './db';
import { AppError } from './errors';
import { attachRealtime, type IO } from './realtime/gateway';
import { createRoomService, type RoomService } from './rooms/service';
import type { TokenService } from './rooms/token';
import { createSwipeService, type SwipeService } from './swipes/service';
import type { TmdbClient } from './tmdb/client';

const DEFAULT_RATE_LIMIT_MAX = 20;
// a full deck is ~20 cards plus prefetches per person; 300/min leaves headroom for a 10-person room on one IP
const DEFAULT_MOVIE_RATE_LIMIT_MAX = 300;

export type { IO } from './realtime/gateway';

export type ServerDeps = {
  prisma: PrismaClient;
  tokens: TokenService;
  tmdb: TmdbClient;
  webOrigin: string;
  region: string;
  logger?: boolean;
  rateLimitMax?: number;
  movieRateLimitMax?: number;
  graceMs?: number;
  eventsPerSecond?: number;
  now?: () => Date;
};

const MovieParams = z.object({ id: z.coerce.number().int().positive() });
const CodeParams = z.object({ code: RoomCodeSchema });
const ProvidersQuery = z.object({ region: RegionSchema.optional() });

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export async function createServer(deps: ServerDeps) {
  const { prisma, tokens, tmdb, webOrigin, region } = deps;
  const rooms: RoomService = createRoomService({ prisma, tokens, tmdb, now: deps.now });
  const swipes: SwipeService = createSwipeService({ prisma });

  const app: FastifyInstance = Fastify({ logger: deps.logger ?? false });
  await app.register(cors, { origin: webOrigin });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(errorBody(err.code, err.message));
    if (err instanceof ZodError) return reply.status(400).send(errorBody('BAD_REQUEST', z.prettifyError(err)));
    if (err.statusCode === 429) return reply.status(429).send(errorBody('RATE_LIMITED', 'Too many requests, slow down'));
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send(errorBody('BAD_REQUEST', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(errorBody('INTERNAL', 'Something went wrong'));
  });

  const limited = { rateLimit: { max: deps.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX, timeWindow: '1 minute' } };
  // TMDB-backed routes spend the server's TMDB quota, so a scan from one IP must not starve real rooms
  const movieLimited = { rateLimit: { max: deps.movieRateLimitMax ?? DEFAULT_MOVIE_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  app.get('/health', async () => ({ ok: true }));

  app.post('/rooms', { config: limited }, async (req, reply) => {
    const { nickname, filters } = CreateRoomBodySchema.parse(req.body);
    return reply.status(201).send(await rooms.createRoom(nickname, filters));
  });

  app.post('/rooms/:code/join', { config: limited }, async (req, reply) => {
    const { code } = CodeParams.parse(req.params);
    const { nickname } = JoinRoomBodySchema.parse(req.body);
    return reply.status(201).send(await rooms.joinRoom(code, nickname));
  });

  app.get('/movies/:id', { config: movieLimited }, async (req) => tmdb.movie(MovieParams.parse(req.params).id));

  app.get('/movies/:id/providers', { config: movieLimited }, async (req) => {
    const { id } = MovieParams.parse(req.params);
    const query = ProvidersQuery.parse(req.query);
    return tmdb.providers(id, query.region ?? region);
  });

  const io: IO = new Server(app.server, { cors: { origin: webOrigin } });
  const realtime = attachRealtime(io, {
    tokens,
    rooms,
    swipes,
    logger: app.log,
    graceMs: deps.graceMs,
    eventsPerSecond: deps.eventsPerSecond,
  });
  app.addHook('preClose', async () => {
    realtime.close();
    io.disconnectSockets(true);
  });

  return { app, io, rooms, swipes };
}
