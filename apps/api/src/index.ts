import 'dotenv/config';
import { startCleanup } from './cleanup';
import { createPrisma } from './db';
import { loadEnv } from './env';
import { createTokenService } from './rooms/token';
import { createServer } from './server';
import { createTmdbClient } from './tmdb/client';

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const { app } = await createServer({
  prisma,
  tokens: createTokenService(env.JWT_SECRET),
  tmdb: createTmdbClient({ apiKey: env.TMDB_API_KEY, baseUrl: env.TMDB_BASE_URL, region: env.TMDB_REGION }),
  webOrigin: env.WEB_ORIGIN,
  region: env.TMDB_REGION,
  logger: true,
});
const stopCleanup = startCleanup({ prisma, logger: app.log });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  stopCleanup();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
