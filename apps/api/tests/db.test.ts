import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDb } from './helpers/db';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

describe('database', () => {
  it('is migrated and empty after reset', async () => {
    await resetDb(prisma);
    expect(await prisma.room.count()).toBe(0);
  });
});
