import type { RoomStatus } from '@mnm/shared';
import type { Prisma, PrismaClient } from '../db';

export type DbClient = PrismaClient | Prisma.TransactionClient;
export type RoundCounts = { active: number; activeSwipes: number };
export type LockedRoom = {
  status: RoomStatus;
  deck: number[];
  matchedMovieId: number | null;
  hostId: string;
  page: number;
};

/**
 * Row-locks the room for the rest of the transaction. Every write that depends on
 * round state (swipes, rechecks, restarts) takes this lock first, so they run one at
 * a time per room. Without it, two concurrent final likes under READ COMMITTED each
 * miss the other's insert and neither sees a full house.
 */
export async function lockRoom(tx: Prisma.TransactionClient, roomId: string): Promise<LockedRoom | null> {
  const rows = await tx.$queryRaw<LockedRoom[]>`
    SELECT status, deck, "matchedMovieId", "hostId", page
    FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
  return rows[0] ?? null;
}

export async function roundCounts(db: DbClient, roomId: string): Promise<RoundCounts> {
  const [active, activeSwipes] = await Promise.all([
    db.member.count({ where: { roomId, isActive: true } }),
    db.swipe.count({ where: { roomId, member: { isActive: true } } }),
  ]);
  return { active, activeSwipes };
}

export function isExhausted({ active, activeSwipes }: RoundCounts, deckLength: number): boolean {
  return active > 0 && deckLength > 0 && activeSwipes >= active * deckLength;
}
