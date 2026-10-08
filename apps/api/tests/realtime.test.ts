import { afterEach, describe, expect, it } from 'vitest';
import { closeAllClients, connectClient, nextEvent, nextState, sleep, type TestClient } from './helpers/clients';
import { resetDb } from './helpers/db';
import { createRoom, joinRoom, startTestServer } from './helpers/server';

type TestServer = Awaited<ReturnType<typeof startTestServer>>;
let server: TestServer | undefined;

async function boot(opts?: Parameters<typeof startTestServer>[0]) {
  server = await startTestServer(opts);
  await resetDb(server.prisma);
  return server;
}

afterEach(async () => {
  closeAllClients();
  await server?.close();
  server = undefined;
});

/** Host "ana" plus the given guests, all connected. */
async function roomWith(srv: TestServer, guests: string[]) {
  const host = await createRoom(srv.app, 'ana');
  const clients: Record<string, TestClient> = { ana: (await connectClient(srv.url, host.token)).socket };
  const tokens: Record<string, string> = { ana: host.token };
  for (const nickname of guests) {
    const { token } = await joinRoom(srv.app, host.code, nickname);
    tokens[nickname] = token;
    clients[nickname] = (await connectClient(srv.url, token)).socket;
  }
  return { code: host.code, clients, tokens };
}

async function startSwiping(clients: Record<string, TestClient>) {
  const ready = Object.values(clients).map((c) => nextState(c, (s) => s.status === 'SWIPING'));
  expect(await clients.ana!.emitWithAck('room:start', {})).toEqual({ ok: true, data: null });
  return Promise.all(ready);
}

describe('handshake', () => {
  it('refuses missing and invalid tokens with ROOM_ENDED', async () => {
    const srv = await boot();
    await expect(connectClient(srv.url, '')).rejects.toThrow('ROOM_ENDED');
    await expect(connectClient(srv.url, 'garbage')).rejects.toThrow('ROOM_ENDED');
  });

  it('sends the joining client a snapshot and refreshes everyone else', async () => {
    const srv = await boot();
    const host = await createRoom(srv.app, 'ana');
    const ana = (await connectClient(srv.url, host.token)).socket;
    const anaSeesBen = nextState(ana, (s) => s.members.some((m) => m.nickname === 'ben'));
    const { token } = await joinRoom(srv.app, host.code, 'ben');
    const { state } = await connectClient(srv.url, token);
    expect(state).toMatchObject({ status: 'LOBBY', position: 0 });
    expect((await anaSeesBen).members.map((m) => m.nickname)).toEqual(['ana', 'ben']);
  });
});

describe('swiping', () => {
  it('plays a room from start to match', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben', 'cal']);
    const states = await startSwiping(clients);
    expect(states.every((s) => s.deck.join() === '11,22,33' && s.position === 0)).toBe(true);

    const matched = Object.values(clients).map((c) => nextEvent(c, 'room:matched'));
    expect(await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true })).toEqual({
      ok: true,
      data: { movieId: 11, likes: 1, needed: 3 },
    });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });
    await clients.cal!.emitWithAck('swipe', { movieId: 11, liked: true });
    expect(await Promise.all(matched)).toEqual([{ movieId: 11 }, { movieId: 11 }, { movieId: 11 }]);
  });

  it('broadcasts progress counts to the room', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const progress = nextEvent(clients.ben!, 'swipe:progress');
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    expect(await progress).toEqual({ movieId: 11, likes: 1, needed: 2 });
  });

  it('rejects non-hosts starting and bad payloads without disconnecting', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    expect(await clients.ben!.emitWithAck('room:start', {})).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    const bad = await clients.ana!.emitWithAck('swipe', { movieId: 'x' } as never);
    expect(bad).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(clients.ana!.connected).toBe(true);
  });

  it('room:sync returns the caller snapshot', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: false });
    expect(await clients.ben!.emitWithAck('room:sync', {})).toMatchObject({ ok: true, data: { position: 1 } });
  });

  it('announces an exhausted deck and lets the host load the next page', async () => {
    const srv = await boot({ decks: [[11], [44, 55]] });
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const exhausted = nextEvent(clients.ben!, 'deck:exhausted');
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: false });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: false });
    await exhausted;

    const fresh = nextState(clients.ben!, (s) => s.deck.join() === '44,55');
    expect(await clients.ana!.emitWithAck('room:restart', {})).toEqual({ ok: true, data: null });
    expect(await fresh).toMatchObject({ position: 0, exhausted: false });
  });

  it('throttles swipe floods per socket', async () => {
    const srv = await boot({ swipesPerSecond: 2 });
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const send = () => clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    await send();
    await send();
    expect(await send()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('presence', () => {
  it('resumes at the right card after a reconnect', async () => {
    const srv = await boot();
    const { clients, tokens } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });
    clients.ben!.disconnect();
    const { state } = await connectClient(srv.url, tokens.ben!);
    expect(state.position).toBe(1);
  });

  it('marks a member inactive after the grace period and completes a pending match', async () => {
    const srv = await boot({ graceMs: 100 });
    const { clients } = await roomWith(srv, ['ben', 'cal']);
    await startSwiping(clients);
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });

    const matched = nextEvent(clients.ana!, 'room:matched');
    const calGone = nextState(clients.ana!, (s) => s.members.some((m) => m.nickname === 'cal' && !m.isActive));
    clients.cal!.disconnect();
    expect(await matched).toEqual({ movieId: 11 });
    await calGone;
  });

  it('keeps a member active when they reconnect within the grace period', async () => {
    const srv = await boot({ graceMs: 200 });
    const { clients, tokens } = await roomWith(srv, ['ben']);
    clients.ben!.disconnect();
    await connectClient(srv.url, tokens.ben!);
    await sleep(350);
    const ben = await srv.prisma.member.findFirstOrThrow({ where: { nickname: 'ben' } });
    expect(ben.isActive).toBe(true);
  });

  it('keeps a member active while another tab is still open', async () => {
    const srv = await boot({ graceMs: 100 });
    const { clients, tokens } = await roomWith(srv, ['ben']);
    await connectClient(srv.url, tokens.ben!);
    clients.ben!.disconnect();
    await sleep(250);
    const ben = await srv.prisma.member.findFirstOrThrow({ where: { nickname: 'ben' } });
    expect(ben.isActive).toBe(true);
  });

  it('reactivates a connected member whose seat was marked inactive, then records the swipe', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    await srv.prisma.member.updateMany({ where: { nickname: 'ben' }, data: { isActive: false } });
    expect(await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true })).toMatchObject({
      ok: true,
      data: { movieId: 11, likes: 1, needed: 2 },
    });
  });

  it('room:leave deactivates immediately and hands off host', async () => {
    const srv = await boot({ graceMs: 10_000 });
    const { clients } = await roomWith(srv, ['ben']);
    const benIsHost = nextState(clients.ben!, (s) => s.members.some((m) => m.nickname === 'ben' && m.isHost));
    expect(await clients.ana!.emitWithAck('room:leave', {})).toEqual({ ok: true, data: null });
    const state = await benIsHost;
    expect(state.members.find((m) => m.nickname === 'ana')?.isActive).toBe(false);
  });
});
