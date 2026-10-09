import {
  type Ack,
  type ClientToServerEvents,
  RestartEventSchema,
  type ServerToClientEvents,
  SwipeEventSchema,
} from '@mnm/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { AppError } from '../errors';
import type { RoomService } from '../rooms/service';
import type { SessionClaims, TokenService } from '../rooms/token';
import type { RoundOutcome, SwipeService } from '../swipes/service';

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SessionClaims>;

export type RealtimeDeps = {
  tokens: TokenService;
  rooms: RoomService;
  swipes: SwipeService;
  logger: Pick<FastifyBaseLogger, 'error'>;
  graceMs?: number;
  eventsPerSecond?: number;
};

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_EVENTS_PER_SECOND = 10;
const RATE_WINDOW_MS = 1000;
const EmptyPayload = z.object({});

const channel = (roomId: string) => `room:${roomId}`;

function createRateLimiter(maxPerWindow: number) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count > maxPerWindow;
  };
}

export function attachRealtime(io: IO, deps: RealtimeDeps): { close(): void } {
  const { tokens, rooms, swipes, logger } = deps;
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const eventsPerSecond = deps.eventsPerSecond ?? DEFAULT_EVENTS_PER_SECOND;
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // keyed by member, not socket, so opening more tabs does not multiply the budget
  const limiters = new Map<string, () => boolean>();
  let isClosed = false;

  function toErrorBody(err: unknown) {
    if (err instanceof AppError) return { error: { code: err.code, message: err.message } };
    if (err instanceof ZodError) return { error: { code: 'BAD_REQUEST', message: z.prettifyError(err) } };
    logger.error({ err }, 'socket handler failed');
    return { error: { code: 'INTERNAL', message: 'Something went wrong' } };
  }

  function handler<P, R>(schema: z.ZodType<P>, fn: (payload: P) => Promise<R>) {
    return async (raw: unknown, ack?: (res: Ack<R>) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, data: await fn(schema.parse(raw ?? {})) });
      } catch (err) {
        reply({ ok: false, ...toErrorBody(err) });
      }
    };
  }

  async function hasLiveSocket(roomId: string, memberId: string): Promise<boolean> {
    const sockets = await io.in(channel(roomId)).fetchSockets();
    return sockets.some((s) => s.data.memberId === memberId);
  }

  async function broadcastState(roomId: string): Promise<void> {
    // ponytail: one snapshot query per socket; fine at ≤10 members, share the room part if rooms grow
    const sockets = await io.in(channel(roomId)).fetchSockets();
    await Promise.all(
      sockets.map(async (s) => s.emit('room:state', await rooms.getSnapshot(roomId, s.data.memberId))),
    );
  }

  function emitOutcome(roomId: string, { matched, exhausted }: RoundOutcome): void {
    if (matched !== null) io.to(channel(roomId)).emit('room:matched', { movieId: matched });
    else if (exhausted) io.to(channel(roomId)).emit('deck:exhausted');
  }

  function isRateLimited(memberId: string): boolean {
    let limiter = limiters.get(memberId);
    if (!limiter) {
      limiter = createRateLimiter(eventsPerSecond);
      limiters.set(memberId, limiter);
    }
    return limiter();
  }

  /** Marks the member active and, if that changed the seat, re-checks matches their earlier likes may now complete. */
  async function activate(roomId: string, memberId: string): Promise<void> {
    if (await rooms.setMemberActive(roomId, memberId, true)) emitOutcome(roomId, await swipes.recheckMatches(roomId));
    await broadcastState(roomId);
  }

  async function deactivate(roomId: string, memberId: string): Promise<void> {
    if (!(await rooms.setMemberActive(roomId, memberId, false))) return;
    emitOutcome(roomId, await swipes.recheckMatches(roomId));
    await broadcastState(roomId);
  }

  function scheduleDeactivation(roomId: string, memberId: string): void {
    graceTimers.set(
      memberId,
      setTimeout(() => {
        graceTimers.delete(memberId);
        void (async () => {
          // a new tab may have connected while the timer ran
          if (isClosed || (await hasLiveSocket(roomId, memberId))) return;
          await deactivate(roomId, memberId);
        })().catch((err) => logger.error({ err, roomId, memberId }, 'deactivate failed'));
      }, graceMs),
    );
  }

  io.use(async (socket, next) => {
    try {
      const token = z.string().min(1).parse(socket.handshake.auth?.token);
      const claims = await tokens.verify(token);
      await rooms.getSnapshot(claims.roomId, claims.memberId);
      socket.data = claims;
      next();
    } catch (err) {
      const isEnded = err instanceof ZodError || (err instanceof AppError && (err.status === 401 || err.status === 410));
      if (!isEnded) logger.error({ err }, 'socket handshake failed');
      next(new Error(isEnded ? 'ROOM_ENDED' : 'SERVER_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    const { roomId, memberId } = socket.data;
    const throttled = <P, R>(schema: z.ZodType<P>, fn: (payload: P) => Promise<R>) =>
      handler(schema, async (payload: P) => {
        if (isRateLimited(memberId)) throw new AppError(429, 'RATE_LIMITED', 'Slow down a little');
        return fn(payload);
      });

    socket.on('room:start', throttled(EmptyPayload, async () => {
      await rooms.startRoom(roomId, memberId);
      await broadcastState(roomId);
      return null;
    }));

    socket.on('room:restart', throttled(RestartEventSchema, async ({ filters }) => {
      await rooms.restartRoom(roomId, memberId, filters);
      await broadcastState(roomId);
      return null;
    }));

    socket.on('swipe', throttled(SwipeEventSchema, async ({ movieId, liked }) => {
      const record = () => swipes.recordSwipe({ roomId, memberId, movieId, liked });
      const result = await record().catch(async (err: unknown) => {
        if (!(err instanceof AppError && err.code === 'MEMBER_INACTIVE')) throw err;
        // this socket is live, so the seat was dropped by a stale grace timer or another tab's leave
        await activate(roomId, memberId);
        return record();
      });
      const progress = { movieId, likes: result.likes, needed: result.needed };
      io.to(channel(roomId)).emit('swipe:progress', progress);
      emitOutcome(roomId, result);
      return progress;
    }));

    socket.on('room:sync', throttled(EmptyPayload, () => rooms.getSnapshot(roomId, memberId)));

    socket.on('room:leave', handler(EmptyPayload, async () => {
      await deactivate(roomId, memberId);
      setImmediate(() => socket.disconnect(true));
      return null;
    }));

    socket.on('disconnect', async () => {
      try {
        if (isClosed || (await hasLiveSocket(roomId, memberId))) return;
        limiters.delete(memberId);
        scheduleDeactivation(roomId, memberId);
      } catch (err) {
        logger.error({ err, roomId, memberId }, 'disconnect handling failed');
      }
    });

    clearTimeout(graceTimers.get(memberId));
    graceTimers.delete(memberId);
    void socket.join(channel(roomId));
    activate(roomId, memberId).catch((err) => {
      logger.error({ err, roomId, memberId }, 'connect handling failed');
      socket.disconnect(true);
    });
  });

  return {
    close() {
      isClosed = true;
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
      limiters.clear();
    },
  };
}
