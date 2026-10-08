import { randomUUID } from 'node:crypto';
import type { RoomStatus } from '@mnm/shared';
import type { PrismaClient } from '../../src/db';
import { generateRoomCode } from '../../src/rooms/code';

type SeedOptions = { nicknames?: string[]; deck?: number[]; status?: RoomStatus; createdAt?: Date };

export async function seedRoom(prisma: PrismaClient, opts: SeedOptions = {}) {
  const { nicknames = ['ana', 'ben'], deck = [11, 22, 33], status = 'SWIPING', createdAt } = opts;
  const memberIds = nicknames.map(() => randomUUID());
  const base = Date.now();
  const room = await prisma.room.create({
    data: {
      code: generateRoomCode(),
      hostId: memberIds[0]!,
      filters: {},
      deck,
      status,
      ...(createdAt ? { createdAt } : {}),
      members: {
        create: nicknames.map((nickname, i) => ({
          id: memberIds[i]!,
          nickname,
          joinedAt: new Date(base + i),
        })),
      },
    },
  });
  return { roomId: room.id, code: room.code, memberIds };
}
