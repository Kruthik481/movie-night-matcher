import { randomUUID } from 'node:crypto';
import {
  type CreateRoomResponse,
  type Filters,
  FiltersSchema,
  type JoinRoomResponse,
  type RoomState,
} from '@mnm/shared';
import { Prisma, type PrismaClient } from '../db';
import { AppError } from '../errors';
import { isExhausted, lockRoom, roundCounts } from '../swipes/round';
import type { TmdbClient } from '../tmdb/client';
import { generateRoomCode } from './code';
import type { TokenService } from './token';

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_MEMBERS = 10;
const CODE_ATTEMPTS = 5;

export type RoomService = {
  createRoom(nickname: string, filters: Filters): Promise<CreateRoomResponse>;
  joinRoom(code: string, nickname: string): Promise<JoinRoomResponse>;
  startRoom(roomId: string, memberId: string): Promise<void>;
  restartRoom(roomId: string, memberId: string, filters?: Filters): Promise<void>;
  getSnapshot(roomId: string, memberId: string): Promise<RoomState>;
  setMemberActive(roomId: string, memberId: string, isActive: boolean): Promise<boolean>;
};

type Deps = {
  prisma: PrismaClient;
  tokens: TokenService;
  tmdb: TmdbClient;
  now?: () => Date;
  makeCode?: () => string;
};

const roomEnded = () => new AppError(410, 'ROOM_ENDED', 'This room has ended');
const notHost = () => new AppError(403, 'NOT_HOST', 'Only the host can do that');
const notSwiping = () => new AppError(409, 'NOT_SWIPING', 'There is no deck to restart');
const deckNotFinished = () => new AppError(409, 'DECK_NOT_FINISHED', 'Everyone has to finish the deck first');
const alreadyStarted = () => new AppError(409, 'ALREADY_STARTED', 'This room has already started');
const noMovies = () => new AppError(422, 'NO_MOVIES', 'No movies match these filters, try widening them');

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export function createRoomService({
  prisma,
  tokens,
  tmdb,
  now = () => new Date(),
  makeCode = () => generateRoomCode(),
}: Deps): RoomService {
  const isExpired = (createdAt: Date) => now().getTime() - createdAt.getTime() >= ROOM_TTL_MS;

  async function loadLiveRoom(roomId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || isExpired(room.createdAt)) throw roomEnded();
    return room;
  }

  async function createRoom(nickname: string, filters: Filters): Promise<CreateRoomResponse> {
    for (let attempt = 1; ; attempt++) {
      const memberId = randomUUID();
      try {
        const room = await prisma.room.create({
          data: {
            code: makeCode(),
            hostId: memberId,
            filters: filters as Prisma.InputJsonValue,
            members: { create: { id: memberId, nickname } },
          },
        });
        return { code: room.code, token: await tokens.sign({ memberId, roomId: room.id }) };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  }

  async function joinRoom(code: string, nickname: string): Promise<JoinRoomResponse> {
    const room = await prisma.room.findUnique({
      where: { code },
      include: { _count: { select: { members: true } } },
    });
    if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'No room with that code');
    if (isExpired(room.createdAt) || room.status === 'MATCHED') throw roomEnded();
    // ponytail: count-then-insert can overshoot by one under a join race; fine for a soft cap
    if (room._count.members >= MAX_MEMBERS) throw new AppError(409, 'ROOM_FULL', 'This room is full');
    try {
      const member = await prisma.member.create({ data: { roomId: room.id, nickname } });
      return { token: await tokens.sign({ memberId: member.id, roomId: room.id }) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'NICKNAME_TAKEN', 'Someone in this room already uses that nickname');
      }
      throw err;
    }
  }

  async function startRoom(roomId: string, memberId: string): Promise<void> {
    const room = await loadLiveRoom(roomId);
    if (room.hostId !== memberId) throw notHost();
    if (room.status !== 'LOBBY') throw alreadyStarted();

    const deck = await tmdb.discover(FiltersSchema.parse(room.filters), 1);
    if (deck.length === 0) throw noMovies();

    const { count } = await prisma.room.updateMany({
      where: { id: roomId, status: 'LOBBY' },
      data: { status: 'SWIPING', deck, page: 1 },
    });
    if (count === 0) throw alreadyStarted();
  }

  async function restartRoom(roomId: string, memberId: string, filters?: Filters): Promise<void> {
    const room = await loadLiveRoom(roomId);
    if (room.hostId !== memberId) throw notHost();
    if (room.status !== 'SWIPING') throw notSwiping();
    // cheap pre-check so we don't call TMDB for a round that isn't over
    if (!isExhausted(await roundCounts(prisma, roomId), room.deck.length)) throw deckNotFinished();

    const nextFilters = filters ?? FiltersSchema.parse(room.filters);
    const page = filters ? 1 : room.page + 1;
    const deck = await tmdb.discover(nextFilters, page);
    if (deck.length === 0) throw noMovies();

    await prisma.$transaction(async (tx) => {
      const locked = await lockRoom(tx, roomId);
      if (!locked || locked.status !== 'SWIPING') throw notSwiping();
      if (!isExhausted(await roundCounts(tx, roomId), locked.deck.length)) throw deckNotFinished();
      await tx.swipe.deleteMany({ where: { roomId } });
      await tx.room.update({
        where: { id: roomId },
        data: { deck, page, filters: nextFilters as Prisma.InputJsonValue },
      });
    });
  }

  async function getSnapshot(roomId: string, memberId: string): Promise<RoomState> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { members: { orderBy: { joinedAt: 'asc' } } },
    });
    if (!room || isExpired(room.createdAt)) throw roomEnded();
    if (!room.members.some((m) => m.id === memberId)) {
      throw new AppError(401, 'UNAUTHORIZED', 'You are not in this room');
    }

    const [position, counts] = await Promise.all([
      prisma.swipe.count({ where: { roomId, memberId } }),
      roundCounts(prisma, roomId),
    ]);
    return {
      code: room.code,
      status: room.status,
      filters: FiltersSchema.parse(room.filters),
      deck: room.deck,
      position,
      matchedMovieId: room.matchedMovieId,
      exhausted: room.status === 'SWIPING' && isExhausted(counts, room.deck.length),
      me: memberId,
      members: room.members.map((m) => ({
        id: m.id,
        nickname: m.nickname,
        isActive: m.isActive,
        isHost: m.id === room.hostId,
      })),
    };
  }

  async function handOffHost(roomId: string, leavingId: string): Promise<void> {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { hostId: true } });
    if (room?.hostId !== leavingId) return;
    const next = await prisma.member.findFirst({
      where: { roomId, isActive: true },
      orderBy: { joinedAt: 'asc' },
      select: { id: true },
    });
    if (next) await prisma.room.update({ where: { id: roomId }, data: { hostId: next.id } });
  }

  async function setMemberActive(roomId: string, memberId: string, isActive: boolean): Promise<boolean> {
    const { count } = await prisma.member.updateMany({
      where: { id: memberId, roomId, isActive: !isActive },
      data: { isActive },
    });
    if (count > 0 && !isActive) await handOffHost(roomId, memberId);
    return count > 0;
  }

  return { createRoom, joinRoom, startRoom, restartRoom, getSnapshot, setMemberActive };
}
