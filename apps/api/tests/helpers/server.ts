import type { AddressInfo } from 'node:net';
import type { CreateRoomResponse, JoinRoomResponse } from '@mnm/shared';
import type { FastifyInstance } from 'fastify';
import { createTokenService } from '../../src/rooms/token';
import { createServer } from '../../src/server';
import { createTestPrisma } from './db';
import { stubTmdb, TEST_JWT_SECRET } from './fakes';

type Options = { decks?: number[][]; graceMs?: number; eventsPerSecond?: number };

export async function startTestServer(opts: Options = {}) {
  const prisma = createTestPrisma();
  const { app } = await createServer({
    prisma,
    tokens: createTokenService(TEST_JWT_SECRET),
    tmdb: stubTmdb(opts.decks),
    webOrigin: 'http://localhost:3000',
    region: 'IN',
    graceMs: opts.graceMs ?? 100,
    eventsPerSecond: opts.eventsPerSecond,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    prisma,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export async function createRoom(app: FastifyInstance, nickname: string): Promise<CreateRoomResponse> {
  const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname } });
  return res.json();
}

export async function joinRoom(app: FastifyInstance, code: string, nickname: string): Promise<JoinRoomResponse> {
  const res = await app.inject({ method: 'POST', url: `/rooms/${code}/join`, payload: { nickname } });
  return res.json();
}
