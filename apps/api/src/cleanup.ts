import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from './db';
import { ROOM_TTL_MS } from './rooms/service';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function deleteExpiredRooms(prisma: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await prisma.room.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - ROOM_TTL_MS) } },
  });
  return count;
}

type CleanupDeps = {
  prisma: PrismaClient;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  intervalMs?: number;
};

export function startCleanup({ prisma, logger, intervalMs = CLEANUP_INTERVAL_MS }: CleanupDeps): () => void {
  const run = () =>
    deleteExpiredRooms(prisma)
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted }, 'expired rooms deleted');
      })
      .catch((err) => logger.error({ err }, 'room cleanup failed'));

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
