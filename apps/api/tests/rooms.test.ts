import { RoomCodeSchema } from '@mnm/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoomService, ROOM_TTL_MS } from '../src/rooms/service';
import { createTokenService } from '../src/rooms/token';
import { createTestPrisma, resetDb } from './helpers/db';
import { stubTmdb, TEST_JWT_SECRET } from './helpers/fakes';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const tokens = createTokenService(TEST_JWT_SECRET);
const noFilters = { genres: [], providers: [] };

function service(opts: { decks?: number[][]; now?: () => Date; makeCode?: () => string } = {}) {
  const tmdb = stubTmdb(opts.decks);
  return { tmdb, rooms: createRoomService({ prisma, tokens, tmdb, now: opts.now, makeCode: opts.makeCode }) };
}

async function finishDeck(roomId: string) {
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } });
  await prisma.swipe.createMany({
    data: room.members.flatMap((m) => room.deck.map((movieId) => ({ roomId, memberId: m.id, movieId, liked: false }))),
  });
}

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('createRoom', () => {
  it('creates a lobby with the creator as host and returns their token', async () => {
    const { rooms } = service();
    const { code, token } = await rooms.createRoom('ana', { genres: [28], providers: [] });
    expect(RoomCodeSchema.parse(code)).toBe(code);
    const claims = await tokens.verify(token);
    const room = await prisma.room.findUniqueOrThrow({ where: { code }, include: { members: true } });
    expect(room).toMatchObject({ id: claims.roomId, hostId: claims.memberId, status: 'LOBBY' });
    expect(room.members).toEqual([expect.objectContaining({ id: claims.memberId, nickname: 'ana' })]);
  });

  it('retries when a generated code collides', async () => {
    await service({ makeCode: () => 'AAAAAA' }).rooms.createRoom('ana', noFilters);
    const codes = ['AAAAAA', 'BBBBBB'];
    const { code } = await service({ makeCode: () => codes.shift()! }).rooms.createRoom('ben', noFilters);
    expect(code).toBe('BBBBBB');
  });
});

describe('joinRoom', () => {
  it('adds a member and returns their token', async () => {
    const { roomId, code } = await seedRoom(prisma, { status: 'LOBBY' });
    const { token } = await service().rooms.joinRoom(code, 'cal');
    expect((await tokens.verify(token)).roomId).toBe(roomId);
  });

  it('rejects unknown codes, taken nicknames, full, matched and expired rooms', async () => {
    const { rooms } = service();
    await expect(rooms.joinRoom('ZZZZZZ', 'x')).rejects.toMatchObject({ status: 404, code: 'ROOM_NOT_FOUND' });

    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(rooms.joinRoom(lobby.code, 'ana')).rejects.toMatchObject({ status: 409, code: 'NICKNAME_TAKEN' });

    const full = await seedRoom(prisma, { nicknames: Array.from({ length: 10 }, (_, i) => `m${i}`) });
    await expect(rooms.joinRoom(full.code, 'late')).rejects.toMatchObject({ status: 409, code: 'ROOM_FULL' });

    const matched = await seedRoom(prisma, { status: 'MATCHED' });
    await expect(rooms.joinRoom(matched.code, 'x')).rejects.toMatchObject({ status: 410, code: 'ROOM_ENDED' });

    const old = await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 1000) });
    await expect(rooms.joinRoom(old.code, 'x')).rejects.toMatchObject({ status: 410 });
  });
});

describe('startRoom', () => {
  it('builds the deck from page 1 and opens swiping', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms, tmdb } = service();
    await rooms.startRoom(roomId, memberIds[0]!);
    expect(tmdb.discover).toHaveBeenCalledWith(noFilters, 1);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({
      status: 'SWIPING',
      deck: [11, 22, 33],
      page: 1,
    });
  });

  it('only lets the host start, and only once', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms } = service();
    await expect(rooms.startRoom(roomId, memberIds[1]!)).rejects.toMatchObject({ status: 403, code: 'NOT_HOST' });
    await rooms.startRoom(roomId, memberIds[0]!);
    await expect(rooms.startRoom(roomId, memberIds[0]!)).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
  });

  it('keeps the room in the lobby when the filters find no movies', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    await expect(service({ decks: [[]] }).rooms.startRoom(roomId, memberIds[0]!)).rejects.toMatchObject({
      status: 422,
      code: 'NO_MOVIES',
    });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe('LOBBY');
  });

  it('leaves the room untouched when TMDB is down', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms, tmdb } = service();
    tmdb.discover.mockRejectedValueOnce(new Error('down'));
    await expect(rooms.startRoom(roomId, memberIds[0]!)).rejects.toThrow('down');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe('LOBBY');
  });
});

describe('restartRoom', () => {
  it('refuses until every active member has finished the deck', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(service().rooms.restartRoom(roomId, memberIds[0]!)).rejects.toMatchObject({
      code: 'DECK_NOT_FINISHED',
    });
  });

  it('loads the next page and clears the old swipes', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    await finishDeck(roomId);
    await service({ decks: [[11, 22], [44, 55]] }).rooms.restartRoom(roomId, memberIds[0]!);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ deck: [44, 55], page: 2 });
    expect(await prisma.swipe.count({ where: { roomId } })).toBe(0);
  });

  it('resets to page 1 and stores new filters when given', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11] });
    await finishDeck(roomId);
    const filters = { genres: [27], providers: [] };
    const { rooms, tmdb } = service({ decks: [[66]] });
    await rooms.restartRoom(roomId, memberIds[0]!, filters);
    expect(tmdb.discover).toHaveBeenCalledWith(filters, 1);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ deck: [66], filters });
  });

  it('starts over from page 1 when the next page is empty', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11] });
    await finishDeck(roomId);
    await service({ decks: [[11]] }).rooms.restartRoom(roomId, memberIds[0]!);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ deck: [11], page: 1 });
    expect(await prisma.swipe.count({ where: { roomId } })).toBe(0);
  });

  it('rejects non-hosts, non-swiping rooms and filters with no movies at all', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11] });
    await finishDeck(roomId);
    const { rooms } = service({ decks: [[]] });
    await expect(rooms.restartRoom(roomId, memberIds[1]!)).rejects.toMatchObject({ code: 'NOT_HOST' });
    await expect(rooms.restartRoom(roomId, memberIds[0]!)).rejects.toMatchObject({ code: 'NO_MOVIES' });
    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(rooms.restartRoom(lobby.roomId, lobby.memberIds[0]!)).rejects.toMatchObject({ code: 'NOT_SWIPING' });
  });
});

describe('getSnapshot', () => {
  it('returns members, my position and exhaustion', async () => {
    const { roomId, code, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    const [ana, ben] = memberIds as [string, string];
    await prisma.swipe.create({ data: { roomId, memberId: ben, movieId: 11, liked: true } });
    const snapshot = await service().rooms.getSnapshot(roomId, ben);
    expect(snapshot).toEqual({
      code,
      status: 'SWIPING',
      filters: noFilters,
      deck: [11, 22],
      position: 1,
      matchedMovieId: null,
      exhausted: false,
      me: ben,
      members: [
        { id: ana, nickname: 'ana', isActive: true, isHost: true },
        { id: ben, nickname: 'ben', isActive: true, isHost: false },
      ],
    });
  });

  it('rejects members of other rooms and expired rooms', async () => {
    const a = await seedRoom(prisma);
    const b = await seedRoom(prisma);
    const { rooms } = service();
    await expect(rooms.getSnapshot(a.roomId, b.memberIds[0]!)).rejects.toMatchObject({ status: 401 });
    const later = service({ now: () => new Date(Date.now() + ROOM_TTL_MS + 1000) }).rooms;
    await expect(later.getSnapshot(a.roomId, a.memberIds[0]!)).rejects.toMatchObject({ status: 410 });
  });
});

describe('setMemberActive', () => {
  it('reports whether anything changed', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const { rooms } = service();
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, true)).toBe(false);
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, false)).toBe(true);
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, false)).toBe(false);
  });

  it('hands host to the earliest active member when the host goes inactive', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben] = memberIds as [string, string, string];
    await service().rooms.setMemberActive(roomId, ana, false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).hostId).toBe(ben);
  });

  it('gives host to a returning member after the host went inactive with nobody left', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana, ben] = memberIds as [string, string];
    const { rooms } = service();
    await rooms.setMemberActive(roomId, ben, false);
    await rooms.setMemberActive(roomId, ana, false);
    await rooms.setMemberActive(roomId, ben, true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).hostId).toBe(ben);
  });

  it('keeps the host when nobody else is active', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana'] });
    await service().rooms.setMemberActive(roomId, memberIds[0]!, false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).hostId).toBe(memberIds[0]);
  });
});
