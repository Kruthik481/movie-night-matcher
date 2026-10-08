import { z } from 'zod';

const UrlString = z.string().refine((value) => URL.canParse(value), 'Must be a valid URL');

const EnvSchema = z.object({
  DATABASE_URL: UrlString,
  TMDB_API_KEY: z.string().min(1, 'TMDB_API_KEY is required'),
  TMDB_BASE_URL: UrlString.default('https://api.themoviedb.org/3'),
  TMDB_REGION: z.string().regex(/^[A-Z]{2}$/).default('IN'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  WEB_ORIGIN: UrlString,
  PORT: z.coerce.number().int().positive().default(4000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
