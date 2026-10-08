import { createPrisma, type PrismaClient } from '../../src/db';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://mnm:mnm@localhost:5433/mnm_test';

export function createTestPrisma(): PrismaClient {
  return createPrisma(TEST_DATABASE_URL);
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "Swipe", "Member", "Room" CASCADE');
}
