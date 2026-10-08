import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './helpers/db';

export default function setup(): void {
  if (!new URL(TEST_DATABASE_URL).pathname.endsWith('_test')) {
    throw new Error(`Refusing to migrate a non-test database: ${TEST_DATABASE_URL}`);
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
