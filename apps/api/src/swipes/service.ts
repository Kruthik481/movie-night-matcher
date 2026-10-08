import type { Prisma, PrismaClient } from '../db';
import { AppError } from '../errors';
import { isExhausted, lockRoom, roundCounts } from './round';

export type RoundOutcome = { matched: number | null; exhausted: boolean };
export type SwipeResult = RoundOutcome & { likes: number; needed: number };
export type SwipeInput = { roomId: string; memberId: string; movieId: number; liked: boolean };

export type SwipeService = {
  recordSwipe(input: SwipeInput): Promise<SwipeResult>;
  recheckMatches(roomId: string): Promise<RoundOutcome>;
};

const NO_OUTCOME: RoundOutcome = { matched: null, exhausted: false };

async function claimMatch(tx: Prisma.TransactionClient, roomId: string, movieId: number): Promise<number | null> {
  const { count } = await tx.room.updateMany({
    where: { id: roomId, matchedMovieId: null },
    data: { status: 'MATCHED', matchedMovieId: movieId },
  });
  return count === 1 ? movieId : null;
}

export function createSwipeService({ prisma }: { prisma: PrismaClient }): SwipeService {
  async function recordSwipe({ roomId, memberId, movieId, liked }: SwipeInput): Promise<SwipeResult> {
    return prisma.$transaction(async (tx) => {
      const room = await lockRoom(tx, roomId);
      if (!room) throw new AppError(410, 'ROOM_ENDED', 'This room has ended');
      if (room.status !== 'SWIPING') throw new AppError(409, 'ROOM_NOT_SWIPING', 'Swiping is not open in this room');

      const member = await tx.member.findFirst({ where: { id: memberId, roomId }, select: { isActive: true } });
      if (!member?.isActive) throw new AppError(409, 'MEMBER_INACTIVE', 'Reconnect to keep swiping');
      if (!room.deck.includes(movieId)) throw new AppError(409, 'NOT_IN_DECK', 'That movie is not in the current deck');

      const existing = await tx.swipe.findUnique({
        where: { roomId_memberId_movieId: { roomId, memberId, movieId } },
      });
      if (!existing) {
        const position = await tx.swipe.count({ where: { roomId, memberId } });
        if (room.deck[position] !== movieId) throw new AppError(409, 'OUT_OF_ORDER', 'Swipe the current card first');
        await tx.swipe.create({ data: { roomId, memberId, movieId, liked } });
      }

      const [likes, counts] = await Promise.all([
        tx.swipe.count({ where: { roomId, movieId, liked: true, member: { isActive: true } } }),
        roundCounts(tx, roomId),
      ]);
      const matched = likes === counts.active ? await claimMatch(tx, roomId, movieId) : null;
      return {
        likes,
        needed: counts.active,
        matched,
        exhausted: matched === null && isExhausted(counts, room.deck.length),
      };
    });
  }

  async function recheckMatches(roomId: string): Promise<RoundOutcome> {
    return prisma.$transaction(async (tx) => {
      const room = await lockRoom(tx, roomId);
      if (!room || room.status !== 'SWIPING') return NO_OUTCOME;

      const counts = await roundCounts(tx, roomId);
      if (counts.active === 0) return NO_OUTCOME;

      const likes = await tx.swipe.groupBy({
        by: ['movieId'],
        where: { roomId, liked: true, member: { isActive: true } },
        _count: { _all: true },
      });
      const likeCount = new Map(likes.map((row) => [row.movieId, row._count._all]));
      const winner = room.deck.find((id) => likeCount.get(id) === counts.active);
      const matched = winner === undefined ? null : await claimMatch(tx, roomId, winner);
      return { matched, exhausted: matched === null && isExhausted(counts, room.deck.length) };
    });
  }

  return { recordSwipe, recheckMatches };
}
