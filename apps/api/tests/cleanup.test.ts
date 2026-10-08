import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteExpiredRooms, startCleanup } from '../src/cleanup';
import { ROOM_TTL_MS } from '../src/rooms/service';
import { createTestPrisma, resetDb } from './helpers/db';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('deleteExpiredRooms', () => {
  it('deletes rooms past the TTL with their members and swipes, keeping fresh ones', async () => {
    const old = await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 60_000) });
    await prisma.swipe.create({ data: { roomId: old.roomId, memberId: old.memberIds[0]!, movieId: 11, liked: true } });
    const fresh = await seedRoom(prisma);

    expect(await deleteExpiredRooms(prisma)).toBe(1);
    expect(await prisma.room.findMany({ select: { id: true } })).toEqual([{ id: fresh.roomId }]);
    expect(await prisma.member.count({ where: { roomId: old.roomId } })).toBe(0);
    expect(await prisma.swipe.count()).toBe(0);
  });
});

describe('startCleanup', () => {
  it('runs immediately, logs deletions, and stops cleanly', async () => {
    await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 60_000) });
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = startCleanup({ prisma, logger, intervalMs: 60_000 });
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith({ deleted: 1 }, 'expired rooms deleted'));
    stop();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
