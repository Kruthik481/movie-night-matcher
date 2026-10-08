import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSwipeService } from '../src/swipes/service';
import { createTestPrisma, resetDb } from './helpers/db';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const swipes = createSwipeService({ prisma });

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

const like = (roomId: string, memberId: string, movieId: number) =>
  swipes.recordSwipe({ roomId, memberId, movieId, liked: true });
const pass = (roomId: string, memberId: string, movieId: number) =>
  swipes.recordSwipe({ roomId, memberId, movieId, liked: false });

describe('recordSwipe', () => {
  it('reports progress without matching until everyone likes', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana] = memberIds as [string, string];
    expect(await like(roomId, ana, 11)).toEqual({ likes: 1, needed: 2, matched: null, exhausted: false });
  });

  it('matches when every active member likes the same movie', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana, ben] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await like(roomId, ben, 11)).toMatchObject({ likes: 2, needed: 2, matched: 11 });
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({
      status: 'MATCHED',
      matchedMovieId: 11,
    });
  });

  it('a single pass blocks the match on that movie', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana, ben] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await pass(roomId, ben, 11)).toMatchObject({ likes: 1, matched: null });
  });

  it('treats a resent swipe as a no-op', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await like(roomId, ana, 11)).toMatchObject({ likes: 1, needed: 2, matched: null });
    expect(await prisma.swipe.count({ where: { roomId } })).toBe(1);
  });

  it('rejects swiping ahead of the current card', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(like(roomId, memberIds[0]!, 22)).rejects.toMatchObject({ status: 409, code: 'OUT_OF_ORDER' });
  });

  it('rejects a movie that is not in the deck (stale client)', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(like(roomId, memberIds[0]!, 999)).rejects.toMatchObject({ status: 409, code: 'NOT_IN_DECK' });
  });

  it('rejects swipes when the room is not swiping', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(like(roomId, memberIds[0]!, 11)).rejects.toMatchObject({ code: 'ROOM_NOT_SWIPING' });
  });

  it('rejects swipes from inactive members', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await prisma.member.update({ where: { id: memberIds[0]! }, data: { isActive: false } });
    await expect(like(roomId, memberIds[0]!, 11)).rejects.toMatchObject({ code: 'MEMBER_INACTIVE' });
  });

  it('rejects swipes for a deleted room', async () => {
    await expect(like('missing-room', 'missing-member', 11)).rejects.toMatchObject({ status: 410 });
  });

  it('flags the deck as exhausted when everyone finishes without a match', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    const [ana, ben] = memberIds as [string, string];
    await pass(roomId, ana, 11);
    await pass(roomId, ana, 22);
    await pass(roomId, ben, 11);
    expect(await pass(roomId, ben, 22)).toMatchObject({ matched: null, exhausted: true });
  });

  it('settles concurrent final likes into exactly one match, never zero', async () => {
    for (let run = 0; run < 10; run++) {
      await resetDb(prisma);
      const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
      const [ana, ben, cal] = memberIds as [string, string, string];
      await like(roomId, ana, 11);
      const results = await Promise.all([like(roomId, ben, 11), like(roomId, cal, 11)]);
      expect(results.filter((r) => r.matched === 11)).toHaveLength(1);
      expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ matchedMovieId: 11 });
    }
  });
});

describe('recheckMatches', () => {
  it('completes a match when the only holdout goes inactive', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    await like(roomId, ana, 11);
    await like(roomId, ben, 11);
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toEqual({ matched: 11, exhausted: false });
  });

  it('picks the earliest deck movie when several qualify', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    for (const member of [ana, ben]) {
      await pass(roomId, member, 11);
      await like(roomId, member, 22);
      await like(roomId, member, 33);
    }
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toMatchObject({ matched: 22 });
  });

  it('reports exhaustion when the remaining members are done', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11], nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    await pass(roomId, ana, 11);
    await pass(roomId, ben, 11);
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toEqual({ matched: null, exhausted: true });
  });

  it('is a no-op outside SWIPING or with nobody active', async () => {
    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    expect(await swipes.recheckMatches(lobby.roomId)).toEqual({ matched: null, exhausted: false });
    const empty = await seedRoom(prisma);
    await prisma.member.updateMany({ where: { roomId: empty.roomId }, data: { isActive: false } });
    expect(await swipes.recheckMatches(empty.roomId)).toEqual({ matched: null, exhausted: false });
  });
});
