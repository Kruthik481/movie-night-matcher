import { defineConfig, devices } from '@playwright/test';

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://mnm:mnm@localhost:5433/mnm_test';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  retries: isCI ? 1 : 0,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/fake-tmdb.mjs',
      url: 'http://localhost:4100/health',
      reuseExistingServer: !isCI,
    },
    {
      command: 'npm run start -w @mnm/api',
      cwd: '../..',
      url: 'http://localhost:4001/health',
      reuseExistingServer: !isCI,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        TMDB_API_KEY: 'fake',
        TMDB_BASE_URL: 'http://localhost:4100',
        JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
        WEB_ORIGIN: 'http://localhost:3100',
        PORT: '4001',
      },
    },
    {
      command: 'npx next dev -p 3100',
      url: 'http://localhost:3100',
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4001' },
    },
  ],
});
