# Movie Night Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live web app where a group joins a room, swipes one shared TMDB deck in real time, and the first movie every active member likes is shown with where it streams in India.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds zod schemas and event types used by both apps. `apps/api` is Fastify + Socket.IO on one Node process with Postgres (Prisma 7) as the source of truth; every swipe runs in a transaction that row-locks the room (`SELECT … FOR UPDATE`) so match detection is race-safe. `apps/web` is a Next.js App Router client that renders whatever `room:state` snapshot the server sends.

**Tech Stack:** Node ≥22, TypeScript 6.0, Fastify 5, Socket.IO 4.8, Prisma 7 + `@prisma/adapter-pg`, Postgres 17, zod 4, jose, Next.js 16, React 19, Tailwind v4, Motion, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-movie-night-matcher-design.md`

## Global Constraints

- Package manager: npm workspaces (pnpm is not installed; Node 25 dropped corepack). Root `package.json` declares `"workspaces": ["packages/*", "apps/*"]`.
- TypeScript pinned to `~6.0.3` (TS 7 is the Go port and lacks the JS API Next.js uses for type checking).
- Prisma 7: generator `prisma-client`, output `apps/api/src/generated/prisma` (gitignored), datasource URL comes from `apps/api/prisma.config.ts`, client built with `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. `prisma` is a runtime dependency (Render installs without devDependencies). Never run `prisma init` (it writes agent skill folders into the repo). Never run `prisma migrate reset` (Prisma blocks it under AI agents; tests TRUNCATE instead).
- All REST bodies, params, queries and socket payloads are validated with the zod schemas in `packages/shared`.
- Match rule: unanimous among **active** members; first hit wins. Deck: one TMDB discover page, deduplicated, same order for everyone.
- Constants: room TTL 24h, presence grace 15s, max 10 members per room, room code 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, token TTL 24h.
- Default watch region `IN`. Footer shows the TMDB attribution line; match screen credits JustWatch.
- Local Postgres: `docker compose` on `localhost:5433`, user/password `mnm`/`mnm`, dev DB `mnm`, test DB `mnm_test`.
- Commits: conventional (`feat:`, `test:`, `chore:`, `docs:`, `ci:`), authored by the user only. No `Co-Authored-By` or session trailers.
- No dependencies beyond those installed in the tasks below.
- Docker Desktop must be running for every task from Task 2 on (API tests need Postgres).

## Review Focus

1. Host's filters are so narrow TMDB returns zero movies → `room:start` fails with "No movies match these filters, try widening them" and the room stays in the lobby (test in Task 6).
2. The host closes their tab → after the grace period another active member becomes host, so the room can still start or load more movies (tests in Tasks 6 and 8).
3. A client with a stale deck (after a restart) or a double-tap sends a swipe for the wrong card → the server rejects it (`NOT_IN_DECK` / `OUT_OF_ORDER`, Task 5), `room:sync` returns a fresh snapshot (Task 8), and those codes are in the client's resync set (Task 10).
4. The same person has the room open in two tabs and closes one → they stay active and the match count is unaffected (test in Task 8).
5. A friend types the room code in lowercase or opens a lowercase link → it still joins (tests in Tasks 1 and 7).

## Spec revisions made during planning

Recorded in the spec by Task 1, Step 1:
- npm workspaces instead of pnpm.
- Presence changes broadcast a fresh `room:state` to everyone instead of `member:joined` / `member:left` (the host can change on leave, and one snapshot keeps every client consistent).
- New client event `room:sync` (ack returns the caller's snapshot) for resync after a rejected stale swipe.
- The server enforces swipe order: a new swipe must be for `deck[mySwipeCount]`.
- Host handoff: when the host goes inactive, the earliest-joined active member becomes host.
- New env `TMDB_BASE_URL` (default `https://api.themoviedb.org/3`) so E2E runs against a fake TMDB.
- Empty deck returns `422 NO_MOVIES`; rooms cap at 10 members (`409 ROOM_FULL`).
- v1 exhausted-deck UI offers "Load 20 more" (same filters, next page); the API already accepts new filters for a later UI.

## File map

```
movie-night-matcher/
  package.json                      workspaces + root scripts
  tsconfig.base.json                shared compiler options
  docker-compose.yml                Postgres 17 on :5433
  docker/init.sql                   creates mnm_test
  .github/workflows/ci.yml          typecheck, lint, tests, e2e
  README.md                         setup, architecture, race write-up
  packages/shared/
    src/index.ts                    zod schemas, constants, event + DTO types
    src/index.test.ts
  apps/api/
    prisma/schema.prisma            Room, Member, Swipe
    prisma.config.ts                Prisma 7 config (datasource URL)
    vitest.config.ts
    src/env.ts                      env schema, loadEnv()
    src/errors.ts                   AppError
    src/db.ts                       createPrisma(), re-exports Prisma types
    src/rooms/code.ts               generateRoomCode()
    src/rooms/token.ts              createTokenService()
    src/rooms/service.ts            createRoomService(): create/join/start/restart/snapshot/presence
    src/swipes/round.ts             lockRoom(), roundCounts(), isExhausted()
    src/swipes/service.ts           createSwipeService(): recordSwipe(), recheckMatches()
    src/tmdb/client.ts              createTmdbClient(): discover/movie/providers, cache, retry
    src/realtime/gateway.ts         attachRealtime(): socket auth, events, presence timers
    src/server.ts                   createServer(): Fastify + routes + Socket.IO wiring
    src/cleanup.ts                  deleteExpiredRooms(), startCleanup()
    src/index.ts                    process entrypoint
    tests/global-setup.ts           applies migrations to mnm_test
    tests/helpers/{db,fakes,seed,server,clients}.ts
    tests/*.test.ts
  apps/web/
    next.config.ts, vitest.config.ts, playwright.config.ts
    app/layout.tsx, app/page.tsx, app/room/[code]/page.tsx, app/globals.css
    lib/api.ts, lib/session.ts, lib/roomReducer.ts, lib/useRoom.ts, lib/useMovie.ts, lib/catalog.ts
    lib/*.test.ts
    components/{ChipGroup,TextField,CreateRoomForm,JoinRoomForm,RoomClient,RoomScreen,Lobby,SwipeDeck,MovieCardView,MatchScreen,ExhaustedPanel,Notice}.tsx
    e2e/fake-tmdb.mjs, e2e/match.spec.ts
```

---

### Task 1: Monorepo scaffold and shared schemas

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Modify: `docs/superpowers/specs/2026-10-08-movie-night-matcher-design.md` (append revisions)
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`@mnm/shared`): `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `NicknameSchema`, `RoomCodeSchema`, `FiltersSchema`, `CreateRoomBodySchema`, `JoinRoomBodySchema`, `SwipeEventSchema`, `RestartEventSchema`, `RegionSchema`; types `Filters`, `RoomStatus`, `MemberView`, `RoomState`, `SwipeProgress`, `SwipeEvent`, `RestartEvent`, `MovieCard`, `ProviderView`, `Providers`, `ErrorBody`, `Ack<T>`, `CreateRoomResponse`, `JoinRoomResponse`, `ServerToClientEvents`, `ClientToServerEvents`.

- [ ] **Step 1: Record the planning revisions in the spec**

Append to `docs/superpowers/specs/2026-10-08-movie-night-matcher-design.md`:

```markdown

## Revisions (2026-10-08, during planning)

- npm workspaces instead of pnpm (pnpm not installed; Node 25 dropped corepack).
- Presence changes broadcast a fresh `room:state` to everyone instead of `member:joined` / `member:left`.
- New client event `room:sync`: ack returns the caller's snapshot; used to resync after a rejected stale swipe.
- Server enforces swipe order: a new swipe must be for `deck[mySwipeCount]` (`409 OUT_OF_ORDER`).
- Host handoff: when the host goes inactive, the earliest-joined active member becomes host.
- New env `TMDB_BASE_URL` (default `https://api.themoviedb.org/3`) for the E2E fake TMDB.
- Empty deck → `422 NO_MOVIES`; rooms cap at 10 members → `409 ROOM_FULL`.
- v1 exhausted-deck UI offers "Load 20 more" (same filters, next page); the API already accepts new filters.
```

- [ ] **Step 2: Create the root workspace files**

`package.json`:

```json
{
  "name": "movie-night-matcher",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "db:up": "docker compose up -d --wait",
    "dev:api": "npm run dev -w @mnm/api",
    "dev:web": "npm run dev -w @mnm/web",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": []
  }
}
```

`.gitignore`:

```
node_modules/
.env
.env.local
apps/api/src/generated/
coverage/
.next/
playwright-report/
test-results/
*.log
.DS_Store
```

- [ ] **Step 3: Create the shared package skeleton**

`packages/shared/package.json`:

```json
{
  "name": "@mnm/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Install:

```bash
cd ~/Desktop/movie-night-matcher
npm i -D typescript@~6.0.3 vitest@^5
npm i -w @mnm/shared zod@^4
```

Expected: `node_modules/` created at root, `package-lock.json` written, no errors.

- [ ] **Step 4: Write the failing test**

`packages/shared/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CreateRoomBodySchema,
  FiltersSchema,
  NicknameSchema,
  RegionSchema,
  RoomCodeSchema,
  SwipeEventSchema,
} from './index';

describe('RoomCodeSchema', () => {
  it('normalizes lowercase and whitespace to the canonical code', () => {
    expect(RoomCodeSchema.parse('  ab3xyz ')).toBe('AB3XYZ');
  });

  it('rejects ambiguous characters I, O, 0 and 1', () => {
    for (const code of ['ABCDEI', 'ABCDEO', 'ABCDE0', 'ABCDE1']) {
      expect(RoomCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it('rejects codes of the wrong length', () => {
    expect(RoomCodeSchema.safeParse('ABCDE').success).toBe(false);
    expect(RoomCodeSchema.safeParse('ABCDEFG').success).toBe(false);
  });
});

describe('NicknameSchema', () => {
  it('trims and enforces 1-24 characters', () => {
    expect(NicknameSchema.parse('  ana  ')).toBe('ana');
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
    expect(NicknameSchema.safeParse('x'.repeat(25)).success).toBe(false);
  });
});

describe('FiltersSchema', () => {
  it('fills defaults for an empty object', () => {
    expect(FiltersSchema.parse({})).toEqual({ genres: [], providers: [] });
  });

  it('rejects a language that is not a 2-letter ISO code', () => {
    expect(FiltersSchema.safeParse({ language: 'hindi' }).success).toBe(false);
  });
});

describe('CreateRoomBodySchema', () => {
  it('defaults filters when omitted', () => {
    expect(CreateRoomBodySchema.parse({ nickname: 'ana' })).toEqual({
      nickname: 'ana',
      filters: { genres: [], providers: [] },
    });
  });
});

describe('SwipeEventSchema', () => {
  it('requires a positive integer movie id and a boolean', () => {
    expect(SwipeEventSchema.safeParse({ movieId: 12, liked: true }).success).toBe(true);
    expect(SwipeEventSchema.safeParse({ movieId: 1.5, liked: true }).success).toBe(false);
    expect(SwipeEventSchema.safeParse({ movieId: 12, liked: 'yes' }).success).toBe(false);
  });
});

describe('RegionSchema', () => {
  it('accepts uppercase ISO 3166 codes only', () => {
    expect(RegionSchema.safeParse('IN').success).toBe(true);
    expect(RegionSchema.safeParse('in').success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -w @mnm/shared`
Expected: FAIL, `Failed to resolve import "./index"` (file does not exist yet).

- [ ] **Step 6: Implement the shared module**

`packages/shared/src/index.ts`:

```ts
import { z } from 'zod';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const NicknameSchema = z
  .string()
  .trim()
  .min(1, 'Nickname is required')
  .max(24, 'Nickname must be 24 characters or fewer');

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'Room code must be 6 letters or digits');

export const FiltersSchema = z.object({
  genres: z.array(z.number().int().positive()).max(10).default([]),
  language: z
    .string()
    .regex(/^[a-z]{2}$/, 'Language must be a 2-letter code')
    .optional(),
  providers: z.array(z.number().int().positive()).max(10).default([]),
});

export const CreateRoomBodySchema = z.object({
  nickname: NicknameSchema,
  filters: FiltersSchema.prefault({}),
});

export const JoinRoomBodySchema = z.object({ nickname: NicknameSchema });

export const SwipeEventSchema = z.object({
  movieId: z.number().int().positive(),
  liked: z.boolean(),
});

export const RestartEventSchema = z.object({ filters: FiltersSchema.optional() });

export const RegionSchema = z.string().regex(/^[A-Z]{2}$/, 'Region must be a 2-letter uppercase code');

export type Filters = z.infer<typeof FiltersSchema>;
export type SwipeEvent = z.infer<typeof SwipeEventSchema>;
export type RestartEvent = z.infer<typeof RestartEventSchema>;

export type RoomStatus = 'LOBBY' | 'SWIPING' | 'MATCHED';

export type MemberView = {
  id: string;
  nickname: string;
  isActive: boolean;
  isHost: boolean;
};

export type RoomState = {
  code: string;
  status: RoomStatus;
  filters: Filters;
  members: MemberView[];
  deck: number[];
  /** Number of cards the receiving member has already swiped; deck[position] is their current card. */
  position: number;
  matchedMovieId: number | null;
  exhausted: boolean;
  /** Member id of the receiving client. */
  me: string;
};

export type SwipeProgress = { movieId: number; likes: number; needed: number };

export type MovieCard = {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
};

export type ProviderView = { id: number; name: string; logoUrl: string | null };

export type Providers = {
  link: string | null;
  flatrate: ProviderView[];
  rent: ProviderView[];
  buy: ProviderView[];
};

export type ErrorBody = { error: { code: string; message: string } };

export type Ack<T> = { ok: true; data: T } | ({ ok: false } & ErrorBody);

export type CreateRoomResponse = { code: string; token: string };
export type JoinRoomResponse = { token: string };

type AckFn<T> = (res: Ack<T>) => void;
type EmptyPayload = Record<string, never>;

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'swipe:progress': (progress: SwipeProgress) => void;
  'room:matched': (match: { movieId: number }) => void;
  'deck:exhausted': () => void;
}

export interface ClientToServerEvents {
  'room:start': (payload: EmptyPayload, ack: AckFn<null>) => void;
  'room:restart': (payload: RestartEvent, ack: AckFn<null>) => void;
  'room:leave': (payload: EmptyPayload, ack: AckFn<null>) => void;
  'room:sync': (payload: EmptyPayload, ack: AckFn<RoomState>) => void;
  swipe: (payload: SwipeEvent, ack: AckFn<SwipeProgress>) => void;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -w @mnm/shared && npm run typecheck -w @mnm/shared`
Expected: 9 tests PASS, `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore packages docs/superpowers/specs
git commit -m "feat: scaffold workspace and shared zod schemas"
```

---

### Task 2: API foundation — env, errors, Prisma schema, test harness

**Files:**
- Create: `docker-compose.yml`, `docker/init.sql`, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/.env.example`, `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/vitest.config.ts`, `apps/api/src/env.ts`, `apps/api/src/errors.ts`, `apps/api/src/db.ts`, `apps/api/tests/global-setup.ts`, `apps/api/tests/helpers/db.ts`
- Create (generated): `apps/api/prisma/migrations/<timestamp>_init/migration.sql`
- Test: `apps/api/tests/env.test.ts`, `apps/api/tests/db.test.ts`

**Interfaces:**
- Consumes: `@mnm/shared` (dependency only).
- Produces:
  - `loadEnv(source?: Record<string, string | undefined>): Env` where `Env = { DATABASE_URL: string; TMDB_API_KEY: string; TMDB_BASE_URL: string; TMDB_REGION: string; JWT_SECRET: string; WEB_ORIGIN: string; PORT: number }`
  - `class AppError extends Error { status: number; code: string }` constructed as `new AppError(status, code, message)`
  - `createPrisma(connectionString: string): PrismaClient`; `src/db.ts` re-exports `Prisma` (value + namespace) and `type PrismaClient`
  - test helpers: `TEST_DATABASE_URL`, `createTestPrisma(): PrismaClient`, `resetDb(prisma): Promise<void>`

- [ ] **Step 1: Start Postgres**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: mnm
      POSTGRES_PASSWORD: mnm
      POSTGRES_DB: mnm
    ports:
      - "5433:5432"
    volumes:
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mnm"]
      interval: 2s
      timeout: 3s
      retries: 15
```

`docker/init.sql`:

```sql
CREATE DATABASE mnm_test;
```

Run: `npm run db:up`
Expected: `Container movie-night-matcher-db-1  Healthy`.

- [ ] **Step 2: Create the API package and install dependencies**

`apps/api/package.json`:

```json
{
  "name": "@mnm/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@mnm/shared": "*"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "tests", "prisma.config.ts", "vitest.config.ts"]
}
```

`apps/api/.env.example` (then `cp apps/api/.env.example apps/api/.env` and fill in a real TMDB v3 key from https://www.themoviedb.org/settings/api and a random secret from `openssl rand -hex 32`):

```
DATABASE_URL=postgresql://mnm:mnm@localhost:5433/mnm
TEST_DATABASE_URL=postgresql://mnm:mnm@localhost:5433/mnm_test
TMDB_API_KEY=your-tmdb-v3-api-key
JWT_SECRET=replace-with-output-of-openssl-rand-hex-32
WEB_ORIGIN=http://localhost:3000
```

`apps/api/prisma.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
```

`apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum RoomStatus {
  LOBBY
  SWIPING
  MATCHED
}

model Room {
  id             String     @id @default(cuid())
  code           String     @unique
  hostId         String
  filters        Json
  deck           Int[]
  page           Int        @default(1)
  status         RoomStatus @default(LOBBY)
  matchedMovieId Int?
  createdAt      DateTime   @default(now())
  members        Member[]
  swipes         Swipe[]

  @@index([createdAt])
}

model Member {
  id       String   @id @default(cuid())
  roomId   String
  room     Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  nickname String
  isActive Boolean  @default(true)
  joinedAt DateTime @default(now())
  swipes   Swipe[]

  @@unique([roomId, nickname])
}

model Swipe {
  roomId    String
  memberId  String
  movieId   Int
  liked     Boolean
  createdAt DateTime @default(now())
  room      Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  member    Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@id([roomId, memberId, movieId])
  @@index([roomId, movieId])
}
```

Install (from repo root):

```bash
npm i -w @mnm/api fastify@^5 @fastify/cors@^11 @fastify/rate-limit@^11 socket.io@^4.8 jose@^6 zod@^4 prisma@^7 @prisma/client@^7 @prisma/adapter-pg@^7 pg dotenv tsx
npm i -D -w @mnm/api @vitest/coverage-v8@^5 @types/node @types/pg socket.io-client@^4.8
```

Expected: install finishes and the `postinstall` hook prints `✔ Generated Prisma Client (7.x) to ./src/generated/prisma`.

- [ ] **Step 3: Create the first migration**

Run: `cd apps/api && npx prisma migrate dev --name init && cd ../..`
Expected: `apps/api/prisma/migrations/<timestamp>_init/migration.sql` created and `Your database is now in sync with your schema.`

- [ ] **Step 4: Write the failing tests**

`apps/api/tests/helpers/db.ts`:

```ts
import { createPrisma, type PrismaClient } from '../../src/db';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://mnm:mnm@localhost:5433/mnm_test';

export function createTestPrisma(): PrismaClient {
  return createPrisma(TEST_DATABASE_URL);
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "Swipe", "Member", "Room" CASCADE');
}
```

`apps/api/tests/global-setup.ts`:

```ts
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
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/index.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
```

`apps/api/tests/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const valid = {
  DATABASE_URL: 'postgresql://mnm:mnm@localhost:5433/mnm',
  TMDB_API_KEY: 'key',
  JWT_SECRET: 'x'.repeat(32),
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      TMDB_BASE_URL: 'https://api.themoviedb.org/3',
      TMDB_REGION: 'IN',
      PORT: 4000,
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast naming every missing or invalid variable', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short', TMDB_API_KEY: undefined })).toThrow(
      /JWT_SECRET[\s\S]*TMDB_API_KEY|TMDB_API_KEY[\s\S]*JWT_SECRET/,
    );
  });

  it('rejects a WEB_ORIGIN that is not a URL', () => {
    expect(() => loadEnv({ ...valid, WEB_ORIGIN: 'localhost' })).toThrow(/WEB_ORIGIN/);
  });
});
```

`apps/api/tests/db.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test -w @mnm/api`
Expected: FAIL, `Failed to resolve import "../src/env"` and `"../../src/db"`.

- [ ] **Step 6: Implement env, errors and db**

`apps/api/src/env.ts`:

```ts
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
```

`apps/api/src/errors.ts`:

```ts
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}
```

`apps/api/src/db.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export { Prisma } from './generated/prisma/client';
export type { PrismaClient } from './generated/prisma/client';

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -w @mnm/api && npm run typecheck -w @mnm/api`
Expected: migrations apply to `mnm_test` (`No pending migrations` on later runs), 5 tests PASS, `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml docker apps/api package.json package-lock.json
git commit -m "feat: add api env validation, prisma schema and test harness"
```

---

### Task 3: Room codes and session tokens

**Files:**
- Create: `apps/api/src/rooms/code.ts`, `apps/api/src/rooms/token.ts`
- Test: `apps/api/tests/code.test.ts`, `apps/api/tests/token.test.ts`

**Interfaces:**
- Consumes: `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `RoomCodeSchema` from `@mnm/shared`; `AppError`.
- Produces:
  - `generateRoomCode(pick?: (max: number) => number): string`
  - `type SessionClaims = { memberId: string; roomId: string }`
  - `type TokenService = { sign(claims: SessionClaims): Promise<string>; verify(token: string): Promise<SessionClaims> }` — `verify` throws `AppError(401, 'UNAUTHORIZED', …)`
  - `createTokenService(secret: string): TokenService`

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/code.test.ts`:

```ts
import { RoomCodeSchema } from '@mnm/shared';
import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../src/rooms/code';

describe('generateRoomCode', () => {
  it('always produces a code the shared schema accepts', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(RoomCodeSchema.parse(code)).toBe(code);
    }
  });

  it('maps picks onto the alphabet', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA');
    expect(generateRoomCode((max) => max - 1)).toBe('999999');
  });
});
```

`apps/api/tests/token.test.ts`:

```ts
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTokenService } from '../src/rooms/token';

const SECRET = 's'.repeat(32);
const claims = { memberId: 'member-1', roomId: 'room-1' };

describe('token service', () => {
  it('round-trips session claims', async () => {
    const tokens = createTokenService(SECRET);
    expect(await tokens.verify(await tokens.sign(claims))).toEqual(claims);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createTokenService('o'.repeat(32)).sign(claims);
    await expect(createTokenService(SECRET).verify(token)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects garbage', async () => {
    await expect(createTokenService(SECRET).verify('not-a-jwt')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ roomId: 'room-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member-1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(createTokenService(SECRET).verify(expired)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token missing the room claim', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member-1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await expect(createTokenService(SECRET).verify(token)).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code.test.ts tests/token.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/rooms/code` and `../src/rooms/token`.

- [ ] **Step 3: Implement**

`apps/api/src/rooms/code.ts`:

```ts
import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@mnm/shared';

export function generateRoomCode(pick: (max: number) => number = randomInt): string {
  return Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[pick(ROOM_CODE_ALPHABET.length)],
  ).join('');
}
```

`apps/api/src/rooms/token.ts`:

```ts
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../errors';

const TOKEN_TTL = '24h';

export type SessionClaims = { memberId: string; roomId: string };

export type TokenService = {
  sign(claims: SessionClaims): Promise<string>;
  verify(token: string): Promise<SessionClaims>;
};

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    sign: ({ memberId, roomId }) =>
      new SignJWT({ roomId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(memberId)
        .setIssuedAt()
        .setExpirationTime(TOKEN_TTL)
        .sign(key),

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (typeof payload.sub !== 'string' || typeof payload.roomId !== 'string') {
          throw new Error('token is missing session claims');
        }
        return { memberId: payload.sub, roomId: payload.roomId };
      } catch {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired session');
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/code.test.ts tests/token.test.ts` (from `apps/api`)
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rooms apps/api/tests/code.test.ts apps/api/tests/token.test.ts
git commit -m "feat: add room code generator and session tokens"
```

---

### Task 4: TMDB client

**Files:**
- Create: `apps/api/src/tmdb/client.ts`
- Test: `apps/api/tests/tmdb.test.ts`

**Interfaces:**
- Consumes: `Filters`, `MovieCard`, `Providers`, `ProviderView` from `@mnm/shared`; `AppError`.
- Produces:
  - `type TmdbClient = { discover(filters: Filters, page: number): Promise<number[]>; movie(id: number): Promise<MovieCard>; providers(id: number, region: string): Promise<Providers> }`
  - `createTmdbClient(opts: { apiKey: string; baseUrl: string; region: string; fetchFn?: typeof fetch; retries?: number; baseDelayMs?: number; now?: () => number }): TmdbClient`
  - Errors: `AppError(404, 'MOVIE_NOT_FOUND')` on TMDB 404 (no retry); `AppError(502, 'TMDB_UNAVAILABLE')` after `retries` retries of network errors, 429 or 5xx; other 4xx → 502 immediately.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/tmdb.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTmdbClient } from '../src/tmdb/client';

type Reply = { status?: number; body?: unknown } | Error;

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies];
  return vi.fn(async (_url: string | URL | Request) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  });
}

function client(fetchFn: ReturnType<typeof fakeFetch>, now = () => 0) {
  return createTmdbClient({
    apiKey: 'k',
    baseUrl: 'https://tmdb.test/3',
    region: 'IN',
    fetchFn: fetchFn as unknown as typeof fetch,
    baseDelayMs: 0,
    now,
  });
}

const calledUrl = (fn: ReturnType<typeof fakeFetch>, call = 0) => new URL(String(fn.mock.calls[call]![0]));

describe('discover', () => {
  it('builds the discover query from filters and page', async () => {
    const fetchFn = fakeFetch({ body: { results: [{ id: 1 }] } });
    await client(fetchFn).discover({ genres: [28, 35], language: 'hi', providers: [8, 119] }, 2);
    const url = calledUrl(fetchFn);
    expect(url.pathname).toBe('/3/discover/movie');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      api_key: 'k',
      with_genres: '28|35',
      with_original_language: 'hi',
      with_watch_providers: '8|119',
      watch_region: 'IN',
      page: '2',
      include_adult: 'false',
    });
  });

  it('omits empty filters', async () => {
    const fetchFn = fakeFetch({ body: { results: [] } });
    await client(fetchFn).discover({ genres: [], providers: [] }, 1);
    const params = calledUrl(fetchFn).searchParams;
    expect(params.has('with_genres')).toBe(false);
    expect(params.has('with_original_language')).toBe(false);
    expect(params.has('with_watch_providers')).toBe(false);
  });

  it('deduplicates ids while keeping order', async () => {
    const fetchFn = fakeFetch({ body: { results: [{ id: 3 }, { id: 1 }, { id: 3 }, { id: 2 }] } });
    expect(await client(fetchFn).discover({ genres: [], providers: [] }, 1)).toEqual([3, 1, 2]);
  });
});

describe('movie', () => {
  it('maps details into a card', async () => {
    const fetchFn = fakeFetch({
      body: { id: 7, title: 'Drishyam', release_date: '2015-07-31', poster_path: '/p.jpg', overview: 'o' },
    });
    expect(await client(fetchFn).movie(7)).toEqual({
      id: 7,
      title: 'Drishyam',
      year: 2015,
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      overview: 'o',
    });
  });

  it('tolerates a missing release date, poster and overview', async () => {
    const fetchFn = fakeFetch({ body: { id: 7, title: 'X', release_date: '', poster_path: null } });
    expect(await client(fetchFn).movie(7)).toMatchObject({ year: null, posterUrl: null, overview: '' });
  });

  it('maps a TMDB 404 without retrying', async () => {
    const fetchFn = fakeFetch({ status: 404 });
    await expect(client(fetchFn).movie(7)).rejects.toMatchObject({ status: 404, code: 'MOVIE_NOT_FOUND' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('providers', () => {
  it('maps the requested region', async () => {
    const fetchFn = fakeFetch({
      body: {
        results: {
          IN: {
            link: 'https://tmdb/watch',
            flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
            rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: null }],
          },
        },
      },
    });
    expect(await client(fetchFn).providers(7, 'IN')).toEqual({
      link: 'https://tmdb/watch',
      flatrate: [{ id: 8, name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/n.png' }],
      rent: [{ id: 2, name: 'Apple TV', logoUrl: null }],
      buy: [],
    });
  });

  it('returns empty lists when the region is absent', async () => {
    const fetchFn = fakeFetch({ body: { results: {} } });
    expect(await client(fetchFn).providers(7, 'IN')).toEqual({ link: null, flatrate: [], rent: [], buy: [] });
  });
});

describe('resilience', () => {
  it('retries 5xx and network errors, then succeeds', async () => {
    const fetchFn = fakeFetch({ status: 503 }, new TypeError('fetch failed'), { body: { results: [{ id: 1 }] } });
    expect(await client(fetchFn).discover({ genres: [], providers: [] }, 1)).toEqual([1]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 retries with TMDB_UNAVAILABLE', async () => {
    const fetchFn = fakeFetch({ status: 429 });
    await expect(client(fetchFn).discover({ genres: [], providers: [] }, 1)).rejects.toMatchObject({
      status: 502,
      code: 'TMDB_UNAVAILABLE',
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('does not retry other 4xx responses', async () => {
    const fetchFn = fakeFetch({ status: 401 });
    await expect(client(fetchFn).movie(1)).rejects.toMatchObject({ status: 502 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('cache', () => {
  it('serves repeats from memory until the TTL passes', async () => {
    let time = 0;
    const fetchFn = fakeFetch({ body: { id: 1, title: 'A', release_date: '2020-01-01', poster_path: null, overview: '' } });
    const tmdb = client(fetchFn, () => time);
    await tmdb.movie(1);
    await tmdb.movie(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    time += 6 * 60 * 60 * 1000;
    await tmdb.movie(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const fetchFn = fakeFetch({ status: 404 }, { body: { id: 1, title: 'A', release_date: '', poster_path: null } });
    const tmdb = client(fetchFn);
    await expect(tmdb.movie(1)).rejects.toMatchObject({ status: 404 });
    await expect(tmdb.movie(1)).resolves.toMatchObject({ title: 'A' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tmdb.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/tmdb/client`.

- [ ] **Step 3: Implement**

`apps/api/src/tmdb/client.ts`:

```ts
import type { Filters, MovieCard, Providers, ProviderView } from '@mnm/shared';
import { AppError } from '../errors';

const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const MIN_VOTE_COUNT = '20';

export type TmdbClient = {
  discover(filters: Filters, page: number): Promise<number[]>;
  movie(id: number): Promise<MovieCard>;
  providers(id: number, region: string): Promise<Providers>;
};

export type TmdbOptions = {
  apiKey: string;
  baseUrl: string;
  region: string;
  fetchFn?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  now?: () => number;
};

type RawProvider = { provider_id: number; provider_name: string; logo_path: string | null };
type RawRegionProviders = { link?: string; flatrate?: RawProvider[]; rent?: RawProvider[]; buy?: RawProvider[] };
type RawMovie = { id: number; title: string; release_date?: string; poster_path: string | null; overview?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toProvider = (p: RawProvider): ProviderView => ({
  id: p.provider_id,
  name: p.provider_name,
  logoUrl: p.logo_path ? `${IMAGE_BASE}/w92${p.logo_path}` : null,
});

export function createTmdbClient(opts: TmdbOptions): TmdbClient {
  const { apiKey, baseUrl, region, fetchFn = fetch, retries = 3, baseDelayMs = 200, now = Date.now } = opts;
  const cache = new Map<string, { at: number; value: unknown }>();

  async function fetchWithRetry<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let status = 0; // 0 = network error
      try {
        const res = await fetchFn(url);
        if (res.ok) return (await res.json()) as T;
        status = res.status;
      } catch {
        // network failure or unreadable body: fall through to the retry decision
      }
      if (status === 404) throw new AppError(404, 'MOVIE_NOT_FOUND', 'Movie not found');
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) {
        throw new AppError(502, 'TMDB_UNAVAILABLE', "Couldn't reach the movie database, try again");
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(baseUrl + path);
    url.searchParams.set('api_key', apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const cacheKey = url.toString();

    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value as T;

    const value = await fetchWithRetry<T>(cacheKey);
    // ponytail: wipe-on-full instead of LRU; swap in an LRU if the hit rate ever matters
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(cacheKey, { at: now(), value });
    return value;
  }

  return {
    async discover(filters, page) {
      const params: Record<string, string> = {
        sort_by: 'popularity.desc',
        include_adult: 'false',
        'vote_count.gte': MIN_VOTE_COUNT,
        watch_region: region,
        page: String(page),
      };
      if (filters.genres.length) params.with_genres = filters.genres.join('|');
      if (filters.language) params.with_original_language = filters.language;
      if (filters.providers.length) params.with_watch_providers = filters.providers.join('|');

      const data = await get<{ results: { id: number }[] }>('/discover/movie', params);
      return [...new Set(data.results.map((r) => r.id))];
    },

    async movie(id) {
      const raw = await get<RawMovie>(`/movie/${id}`);
      return {
        id: raw.id,
        title: raw.title,
        year: raw.release_date ? Number(raw.release_date.slice(0, 4)) : null,
        posterUrl: raw.poster_path ? `${IMAGE_BASE}/w500${raw.poster_path}` : null,
        overview: raw.overview ?? '',
      };
    },

    async providers(id, regionCode) {
      const data = await get<{ results: Record<string, RawRegionProviders> }>(`/movie/${id}/watch/providers`);
      const entry = data.results[regionCode];
      return {
        link: entry?.link ?? null,
        flatrate: (entry?.flatrate ?? []).map(toProvider),
        rent: (entry?.rent ?? []).map(toProvider),
        buy: (entry?.buy ?? []).map(toProvider),
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tmdb.test.ts` (from `apps/api`)
Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tmdb apps/api/tests/tmdb.test.ts
git commit -m "feat: add cached, retrying TMDB client"
```

---

### Task 5: Round helpers and swipe service (race-safe match detection)

**Files:**
- Create: `apps/api/src/swipes/round.ts`, `apps/api/src/swipes/service.ts`, `apps/api/tests/helpers/seed.ts`
- Test: `apps/api/tests/swipes.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`, `Prisma` from `src/db`; `AppError`; `generateRoomCode`; `RoomStatus` from `@mnm/shared`.
- Produces:
  - `src/swipes/round.ts`: `type DbClient = PrismaClient | Prisma.TransactionClient`; `type RoundCounts = { active: number; activeSwipes: number }`; `roundCounts(db: DbClient, roomId: string): Promise<RoundCounts>`; `isExhausted(counts: RoundCounts, deckLength: number): boolean`; `type LockedRoom = { status: RoomStatus; deck: number[]; matchedMovieId: number | null; hostId: string; page: number }`; `lockRoom(tx: Prisma.TransactionClient, roomId: string): Promise<LockedRoom | null>`
  - `src/swipes/service.ts`: `type RoundOutcome = { matched: number | null; exhausted: boolean }`; `type SwipeResult = RoundOutcome & { likes: number; needed: number }`; `type SwipeService = { recordSwipe(input: { roomId: string; memberId: string; movieId: number; liked: boolean }): Promise<SwipeResult>; recheckMatches(roomId: string): Promise<RoundOutcome> }`; `createSwipeService(deps: { prisma: PrismaClient }): SwipeService`
  - Errors from `recordSwipe`: `410 ROOM_ENDED`, `409 ROOM_NOT_SWIPING`, `409 MEMBER_INACTIVE`, `409 NOT_IN_DECK`, `409 OUT_OF_ORDER`.
  - Test helper `seedRoom(prisma, opts?: { nicknames?: string[]; deck?: number[]; status?: RoomStatus; createdAt?: Date }): Promise<{ roomId: string; code: string; memberIds: string[] }>` (first nickname is host; members join in order).

- [ ] **Step 1: Write the seed helper**

`apps/api/tests/helpers/seed.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

`apps/api/tests/swipes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSwipeService } from '../src/swipes/service';
import { createTestPrisma, resetDb } from './helpers/db';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const swipes = createSwipeService({ prisma });

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

const like = (roomId: string, memberId: string, movieId: number) =>
  swipes.recordSwipe({ roomId, memberId, movieId, liked: true });
const pass = (roomId: string, memberId: string, movieId: number) =>
  swipes.recordSwipe({ roomId, memberId, movieId, liked: false });

describe('recordSwipe', () => {
  it('reports progress without matching until everyone likes', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana] = memberIds as [string, string];
    expect(await like(roomId, ana, 11)).toEqual({ likes: 1, needed: 2, matched: null, exhausted: false });
  });

  it('matches when every active member likes the same movie', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana, ben] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await like(roomId, ben, 11)).toMatchObject({ likes: 2, needed: 2, matched: 11 });
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({
      status: 'MATCHED',
      matchedMovieId: 11,
    });
  });

  it('a single pass blocks the match on that movie', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana, ben] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await pass(roomId, ben, 11)).toMatchObject({ likes: 1, matched: null });
  });

  it('treats a resent swipe as a no-op', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const [ana] = memberIds as [string, string];
    await like(roomId, ana, 11);
    expect(await like(roomId, ana, 11)).toMatchObject({ likes: 1, needed: 2, matched: null });
    expect(await prisma.swipe.count({ where: { roomId } })).toBe(1);
  });

  it('rejects swiping ahead of the current card', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(like(roomId, memberIds[0]!, 22)).rejects.toMatchObject({ status: 409, code: 'OUT_OF_ORDER' });
  });

  it('rejects a movie that is not in the deck (stale client)', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(like(roomId, memberIds[0]!, 999)).rejects.toMatchObject({ status: 409, code: 'NOT_IN_DECK' });
  });

  it('rejects swipes when the room is not swiping', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(like(roomId, memberIds[0]!, 11)).rejects.toMatchObject({ code: 'ROOM_NOT_SWIPING' });
  });

  it('rejects swipes from inactive members', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await prisma.member.update({ where: { id: memberIds[0]! }, data: { isActive: false } });
    await expect(like(roomId, memberIds[0]!, 11)).rejects.toMatchObject({ code: 'MEMBER_INACTIVE' });
  });

  it('rejects swipes for a deleted room', async () => {
    await expect(like('missing-room', 'missing-member', 11)).rejects.toMatchObject({ status: 410 });
  });

  it('flags the deck as exhausted when everyone finishes without a match', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    const [ana, ben] = memberIds as [string, string];
    await pass(roomId, ana, 11);
    await pass(roomId, ana, 22);
    await pass(roomId, ben, 11);
    expect(await pass(roomId, ben, 22)).toMatchObject({ matched: null, exhausted: true });
  });

  it('settles concurrent final likes into exactly one match, never zero', async () => {
    for (let run = 0; run < 10; run++) {
      await resetDb(prisma);
      const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
      const [ana, ben, cal] = memberIds as [string, string, string];
      await like(roomId, ana, 11);
      const results = await Promise.all([like(roomId, ben, 11), like(roomId, cal, 11)]);
      expect(results.filter((r) => r.matched === 11)).toHaveLength(1);
      expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ matchedMovieId: 11 });
    }
  });
});

describe('recheckMatches', () => {
  it('completes a match when the only holdout goes inactive', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    await like(roomId, ana, 11);
    await like(roomId, ben, 11);
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toEqual({ matched: 11, exhausted: false });
  });

  it('picks the earliest deck movie when several qualify', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    for (const member of [ana, ben]) {
      await pass(roomId, member, 11);
      await like(roomId, member, 22);
      await like(roomId, member, 33);
    }
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toMatchObject({ matched: 22 });
  });

  it('reports exhaustion when the remaining members are done', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11], nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben, cal] = memberIds as [string, string, string];
    await pass(roomId, ana, 11);
    await pass(roomId, ben, 11);
    await prisma.member.update({ where: { id: cal }, data: { isActive: false } });
    expect(await swipes.recheckMatches(roomId)).toEqual({ matched: null, exhausted: true });
  });

  it('is a no-op outside SWIPING or with nobody active', async () => {
    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    expect(await swipes.recheckMatches(lobby.roomId)).toEqual({ matched: null, exhausted: false });
    const empty = await seedRoom(prisma);
    await prisma.member.updateMany({ where: { roomId: empty.roomId }, data: { isActive: false } });
    expect(await swipes.recheckMatches(empty.roomId)).toEqual({ matched: null, exhausted: false });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/swipes.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/swipes/service`.

- [ ] **Step 4: Implement the round helpers**

`apps/api/src/swipes/round.ts`:

```ts
import type { RoomStatus } from '@mnm/shared';
import type { Prisma, PrismaClient } from '../db';

export type DbClient = PrismaClient | Prisma.TransactionClient;
export type RoundCounts = { active: number; activeSwipes: number };
export type LockedRoom = {
  status: RoomStatus;
  deck: number[];
  matchedMovieId: number | null;
  hostId: string;
  page: number;
};

/**
 * Row-locks the room for the rest of the transaction. Every write that depends on
 * round state (swipes, rechecks, restarts) takes this lock first, so they run one at
 * a time per room. Without it, two concurrent final likes under READ COMMITTED each
 * miss the other's insert and neither sees a full house.
 */
export async function lockRoom(tx: Prisma.TransactionClient, roomId: string): Promise<LockedRoom | null> {
  const rows = await tx.$queryRaw<LockedRoom[]>`
    SELECT status, deck, "matchedMovieId", "hostId", page
    FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
  return rows[0] ?? null;
}

export async function roundCounts(db: DbClient, roomId: string): Promise<RoundCounts> {
  const [active, activeSwipes] = await Promise.all([
    db.member.count({ where: { roomId, isActive: true } }),
    db.swipe.count({ where: { roomId, member: { isActive: true } } }),
  ]);
  return { active, activeSwipes };
}

export function isExhausted({ active, activeSwipes }: RoundCounts, deckLength: number): boolean {
  return active > 0 && deckLength > 0 && activeSwipes >= active * deckLength;
}
```

- [ ] **Step 5: Implement the swipe service**

`apps/api/src/swipes/service.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/swipes.test.ts` (from `apps/api`)
Expected: 15 tests PASS.

- [ ] **Step 7: Prove the lock matters**

Temporarily delete ` FOR UPDATE` from `lockRoom` and run `npx vitest run tests/swipes.test.ts -t "concurrent"` a few times; expect a failure like `expected [] to have a length of 1`. Restore ` FOR UPDATE` and confirm it passes again. Note the observed failure for the README write-up (Task 14).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/swipes apps/api/tests/swipes.test.ts apps/api/tests/helpers/seed.ts
git commit -m "feat: add race-safe swipe recording and match detection"
```

---

### Task 6: Room service

**Files:**
- Create: `apps/api/src/rooms/service.ts`, `apps/api/tests/helpers/fakes.ts`
- Test: `apps/api/tests/rooms.test.ts`

**Interfaces:**
- Consumes: `FiltersSchema`, `Filters`, `RoomState`, `CreateRoomResponse`, `JoinRoomResponse` from `@mnm/shared`; `Prisma`, `PrismaClient`; `AppError`; `TmdbClient`; `TokenService`; `generateRoomCode`; `lockRoom`, `roundCounts`, `isExhausted`.
- Produces:
  - `ROOM_TTL_MS = 86_400_000`, `MAX_MEMBERS = 10`
  - `type RoomService = { createRoom(nickname: string, filters: Filters): Promise<CreateRoomResponse>; joinRoom(code: string, nickname: string): Promise<JoinRoomResponse>; startRoom(roomId: string, memberId: string): Promise<void>; restartRoom(roomId: string, memberId: string, filters?: Filters): Promise<void>; getSnapshot(roomId: string, memberId: string): Promise<RoomState>; setMemberActive(roomId: string, memberId: string, isActive: boolean): Promise<boolean> }`
  - `createRoomService(deps: { prisma: PrismaClient; tokens: TokenService; tmdb: TmdbClient; now?: () => Date; makeCode?: () => string }): RoomService`
  - Errors: `404 ROOM_NOT_FOUND`, `410 ROOM_ENDED`, `409 NICKNAME_TAKEN`, `409 ROOM_FULL`, `403 NOT_HOST`, `409 ALREADY_STARTED`, `409 NOT_SWIPING`, `409 DECK_NOT_FINISHED`, `422 NO_MOVIES`, `401 UNAUTHORIZED` (member not in room).
  - Test helpers in `tests/helpers/fakes.ts`: `TEST_JWT_SECRET`; `stubTmdb(decks?: number[][])` returning a `TmdbClient` whose methods are `vi.fn`s; `discover(_, page)` returns `decks[page - 1] ?? []`.

- [ ] **Step 1: Write the TMDB stub**

`apps/api/tests/helpers/fakes.ts`:

```ts
import type { Filters, MovieCard, Providers } from '@mnm/shared';
import { vi } from 'vitest';
import type { TmdbClient } from '../../src/tmdb/client';

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret!';

export function stubTmdb(decks: number[][] = [[11, 22, 33]]) {
  return {
    discover: vi.fn(async (_filters: Filters, page: number) => decks[page - 1] ?? []),
    movie: vi.fn(async (id: number): Promise<MovieCard> => ({
      id,
      title: `Movie ${id}`,
      year: 2024,
      posterUrl: null,
      overview: '',
    })),
    providers: vi.fn(async (_id: number, _region: string): Promise<Providers> => ({
      link: null,
      flatrate: [],
      rent: [],
      buy: [],
    })),
  } satisfies TmdbClient;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/tests/rooms.test.ts`:

```ts
import { RoomCodeSchema } from '@mnm/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoomService, ROOM_TTL_MS } from '../src/rooms/service';
import { createTokenService } from '../src/rooms/token';
import { createTestPrisma, resetDb } from './helpers/db';
import { stubTmdb, TEST_JWT_SECRET } from './helpers/fakes';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const tokens = createTokenService(TEST_JWT_SECRET);
const noFilters = { genres: [], providers: [] };

function service(opts: { decks?: number[][]; now?: () => Date; makeCode?: () => string } = {}) {
  const tmdb = stubTmdb(opts.decks);
  return { tmdb, rooms: createRoomService({ prisma, tokens, tmdb, now: opts.now, makeCode: opts.makeCode }) };
}

async function finishDeck(roomId: string) {
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } });
  await prisma.swipe.createMany({
    data: room.members.flatMap((m) => room.deck.map((movieId) => ({ roomId, memberId: m.id, movieId, liked: false }))),
  });
}

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('createRoom', () => {
  it('creates a lobby with the creator as host and returns their token', async () => {
    const { rooms } = service();
    const { code, token } = await rooms.createRoom('ana', { genres: [28], providers: [] });
    expect(RoomCodeSchema.parse(code)).toBe(code);
    const claims = await tokens.verify(token);
    const room = await prisma.room.findUniqueOrThrow({ where: { code }, include: { members: true } });
    expect(room).toMatchObject({ id: claims.roomId, hostId: claims.memberId, status: 'LOBBY' });
    expect(room.members).toEqual([expect.objectContaining({ id: claims.memberId, nickname: 'ana' })]);
  });

  it('retries when a generated code collides', async () => {
    await service({ makeCode: () => 'AAAAAA' }).rooms.createRoom('ana', noFilters);
    const codes = ['AAAAAA', 'BBBBBB'];
    const { code } = await service({ makeCode: () => codes.shift()! }).rooms.createRoom('ben', noFilters);
    expect(code).toBe('BBBBBB');
  });
});

describe('joinRoom', () => {
  it('adds a member and returns their token', async () => {
    const { roomId, code } = await seedRoom(prisma, { status: 'LOBBY' });
    const { token } = await service().rooms.joinRoom(code, 'cal');
    expect((await tokens.verify(token)).roomId).toBe(roomId);
  });

  it('rejects unknown codes, taken nicknames, full, matched and expired rooms', async () => {
    const { rooms } = service();
    await expect(rooms.joinRoom('ZZZZZZ', 'x')).rejects.toMatchObject({ status: 404, code: 'ROOM_NOT_FOUND' });

    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(rooms.joinRoom(lobby.code, 'ana')).rejects.toMatchObject({ status: 409, code: 'NICKNAME_TAKEN' });

    const full = await seedRoom(prisma, { nicknames: Array.from({ length: 10 }, (_, i) => `m${i}`) });
    await expect(rooms.joinRoom(full.code, 'late')).rejects.toMatchObject({ status: 409, code: 'ROOM_FULL' });

    const matched = await seedRoom(prisma, { status: 'MATCHED' });
    await expect(rooms.joinRoom(matched.code, 'x')).rejects.toMatchObject({ status: 410, code: 'ROOM_ENDED' });

    const old = await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 1000) });
    await expect(rooms.joinRoom(old.code, 'x')).rejects.toMatchObject({ status: 410 });
  });
});

describe('startRoom', () => {
  it('builds the deck from page 1 and opens swiping', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms, tmdb } = service();
    await rooms.startRoom(roomId, memberIds[0]!);
    expect(tmdb.discover).toHaveBeenCalledWith(noFilters, 1);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({
      status: 'SWIPING',
      deck: [11, 22, 33],
      page: 1,
    });
  });

  it('only lets the host start, and only once', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms } = service();
    await expect(rooms.startRoom(roomId, memberIds[1]!)).rejects.toMatchObject({ status: 403, code: 'NOT_HOST' });
    await rooms.startRoom(roomId, memberIds[0]!);
    await expect(rooms.startRoom(roomId, memberIds[0]!)).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
  });

  it('keeps the room in the lobby when the filters find no movies', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    await expect(service({ decks: [[]] }).rooms.startRoom(roomId, memberIds[0]!)).rejects.toMatchObject({
      status: 422,
      code: 'NO_MOVIES',
    });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe('LOBBY');
  });

  it('leaves the room untouched when TMDB is down', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { status: 'LOBBY', deck: [] });
    const { rooms, tmdb } = service();
    tmdb.discover.mockRejectedValueOnce(new Error('down'));
    await expect(rooms.startRoom(roomId, memberIds[0]!)).rejects.toThrow('down');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe('LOBBY');
  });
});

describe('restartRoom', () => {
  it('refuses until every active member has finished the deck', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    await expect(service().rooms.restartRoom(roomId, memberIds[0]!)).rejects.toMatchObject({
      code: 'DECK_NOT_FINISHED',
    });
  });

  it('loads the next page and clears the old swipes', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    await finishDeck(roomId);
    await service({ decks: [[11, 22], [44, 55]] }).rooms.restartRoom(roomId, memberIds[0]!);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ deck: [44, 55], page: 2 });
    expect(await prisma.swipe.count({ where: { roomId } })).toBe(0);
  });

  it('resets to page 1 and stores new filters when given', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11] });
    await finishDeck(roomId);
    const filters = { genres: [27], providers: [] };
    const { rooms, tmdb } = service({ decks: [[66]] });
    await rooms.restartRoom(roomId, memberIds[0]!, filters);
    expect(tmdb.discover).toHaveBeenCalledWith(filters, 1);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).toMatchObject({ deck: [66], filters });
  });

  it('rejects non-hosts, non-swiping rooms and empty next pages', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { deck: [11] });
    await finishDeck(roomId);
    const { rooms } = service({ decks: [[11]] });
    await expect(rooms.restartRoom(roomId, memberIds[1]!)).rejects.toMatchObject({ code: 'NOT_HOST' });
    await expect(rooms.restartRoom(roomId, memberIds[0]!)).rejects.toMatchObject({ code: 'NO_MOVIES' });
    const lobby = await seedRoom(prisma, { status: 'LOBBY' });
    await expect(rooms.restartRoom(lobby.roomId, lobby.memberIds[0]!)).rejects.toMatchObject({ code: 'NOT_SWIPING' });
  });
});

describe('getSnapshot', () => {
  it('returns members, my position and exhaustion', async () => {
    const { roomId, code, memberIds } = await seedRoom(prisma, { deck: [11, 22] });
    const [ana, ben] = memberIds as [string, string];
    await prisma.swipe.create({ data: { roomId, memberId: ben, movieId: 11, liked: true } });
    const snapshot = await service().rooms.getSnapshot(roomId, ben);
    expect(snapshot).toEqual({
      code,
      status: 'SWIPING',
      filters: noFilters,
      deck: [11, 22],
      position: 1,
      matchedMovieId: null,
      exhausted: false,
      me: ben,
      members: [
        { id: ana, nickname: 'ana', isActive: true, isHost: true },
        { id: ben, nickname: 'ben', isActive: true, isHost: false },
      ],
    });
  });

  it('rejects members of other rooms and expired rooms', async () => {
    const a = await seedRoom(prisma);
    const b = await seedRoom(prisma);
    const { rooms } = service();
    await expect(rooms.getSnapshot(a.roomId, b.memberIds[0]!)).rejects.toMatchObject({ status: 401 });
    const later = service({ now: () => new Date(Date.now() + ROOM_TTL_MS + 1000) }).rooms;
    await expect(later.getSnapshot(a.roomId, a.memberIds[0]!)).rejects.toMatchObject({ status: 410 });
  });
});

describe('setMemberActive', () => {
  it('reports whether anything changed', async () => {
    const { roomId, memberIds } = await seedRoom(prisma);
    const { rooms } = service();
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, true)).toBe(false);
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, false)).toBe(true);
    expect(await rooms.setMemberActive(roomId, memberIds[1]!, false)).toBe(false);
  });

  it('hands host to the earliest active member when the host goes inactive', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana', 'ben', 'cal'] });
    const [ana, ben] = memberIds as [string, string, string];
    await service().rooms.setMemberActive(roomId, ana, false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).hostId).toBe(ben);
  });

  it('keeps the host when nobody else is active', async () => {
    const { roomId, memberIds } = await seedRoom(prisma, { nicknames: ['ana'] });
    await service().rooms.setMemberActive(roomId, memberIds[0]!, false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).hostId).toBe(memberIds[0]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/rooms.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/rooms/service`.

- [ ] **Step 4: Implement**

`apps/api/src/rooms/service.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/rooms.test.ts` (from `apps/api`)
Expected: 17 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/rooms/service.ts apps/api/tests/rooms.test.ts apps/api/tests/helpers/fakes.ts
git commit -m "feat: add room lifecycle service with host handoff"
```

---

### Task 7: HTTP server and REST routes

**Files:**
- Create: `apps/api/src/server.ts`
- Test: `apps/api/tests/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6. (Task 8 wires `attachRealtime` into this file.)
- Produces:
  - `type ServerDeps = { prisma: PrismaClient; tokens: TokenService; tmdb: TmdbClient; webOrigin: string; region: string; logger?: boolean; rateLimitMax?: number; graceMs?: number; swipesPerSecond?: number; now?: () => Date }`
  - `createServer(deps: ServerDeps): Promise<{ app: FastifyInstance; io: IO; rooms: RoomService; swipes: SwipeService }>` where `IO` is the typed Socket.IO server (declared here, moved to `realtime/gateway.ts` in Task 8)
  - Error body for every non-2xx response: `{ error: { code: string; message: string } }`
  - Routes: `GET /health`, `POST /rooms` (201), `POST /rooms/:code/join` (201), `GET /movies/:id`, `GET /movies/:id/providers?region=XX`

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/routes.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { createTokenService } from '../src/rooms/token';
import { createServer } from '../src/server';
import { createTestPrisma, resetDb } from './helpers/db';
import { stubTmdb, TEST_JWT_SECRET } from './helpers/fakes';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
const tokens = createTokenService(TEST_JWT_SECRET);
let app: FastifyInstance;
let tmdb: ReturnType<typeof stubTmdb>;

async function build(rateLimitMax = 100) {
  tmdb = stubTmdb();
  ({ app } = await createServer({ prisma, tokens, tmdb, webOrigin: 'http://localhost:3000', region: 'IN', rateLimitMax }));
}

beforeEach(async () => {
  await resetDb(prisma);
  await build();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe('GET /health', () => {
  it('responds ok', async () => {
    expect((await app.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });
});

describe('POST /rooms', () => {
  it('creates a room', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname: 'ana', filters: { genres: [28] } } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ code: expect.stringMatching(/^[A-Z2-9]{6}$/), token: expect.any(String) });
  });

  it('returns 400 with a readable message for bad input', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Nickname') });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('rate limits room creation', async () => {
    await app.close();
    await build(2);
    const create = () => app.inject({ method: 'POST', url: '/rooms', payload: { nickname: 'ana' } });
    await create();
    await create();
    const res = await create();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /rooms/:code/join', () => {
  it('joins with a lowercase code', async () => {
    const { code } = await seedRoom(prisma, { status: 'LOBBY' });
    const res = await app.inject({ method: 'POST', url: `/rooms/${code.toLowerCase()}/join`, payload: { nickname: 'cal' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ token: expect.any(String) });
  });

  it('maps service errors to status codes', async () => {
    const { code } = await seedRoom(prisma, { status: 'LOBBY' });
    const join = (c: string, nickname: string) =>
      app.inject({ method: 'POST', url: `/rooms/${c}/join`, payload: { nickname } });
    expect((await join('ZZZZZZ', 'x')).statusCode).toBe(404);
    expect((await join(code, 'ana')).statusCode).toBe(409);
    expect((await join('bad!', 'x')).statusCode).toBe(400);
  });
});

describe('GET /movies', () => {
  it('returns a movie card', async () => {
    const res = await app.inject({ url: '/movies/42' });
    expect(res.json()).toMatchObject({ id: 42, title: 'Movie 42' });
  });

  it('rejects a non-numeric id', async () => {
    expect((await app.inject({ url: '/movies/abc' })).statusCode).toBe(400);
  });

  it('passes TMDB failures through with their code', async () => {
    tmdb.movie.mockRejectedValueOnce(new AppError(502, 'TMDB_UNAVAILABLE', 'down'));
    const res = await app.inject({ url: '/movies/42' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('TMDB_UNAVAILABLE');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    tmdb.movie.mockRejectedValueOnce(new Error('secret stack detail'));
    const res = await app.inject({ url: '/movies/42' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('defaults providers to the configured region and validates overrides', async () => {
    await app.inject({ url: '/movies/42/providers' });
    expect(tmdb.providers).toHaveBeenCalledWith(42, 'IN');
    await app.inject({ url: '/movies/42/providers?region=US' });
    expect(tmdb.providers).toHaveBeenLastCalledWith(42, 'US');
    expect((await app.inject({ url: '/movies/42/providers?region=us' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/routes.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/server`.

- [ ] **Step 3: Implement**

`apps/api/src/server.ts`:

```ts
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  type ClientToServerEvents,
  CreateRoomBodySchema,
  JoinRoomBodySchema,
  RegionSchema,
  RoomCodeSchema,
  type ServerToClientEvents,
} from '@mnm/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import type { PrismaClient } from './db';
import { AppError } from './errors';
import { createRoomService, type RoomService } from './rooms/service';
import type { SessionClaims, TokenService } from './rooms/token';
import { createSwipeService, type SwipeService } from './swipes/service';
import type { TmdbClient } from './tmdb/client';

const DEFAULT_RATE_LIMIT_MAX = 20;

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SessionClaims>;

export type ServerDeps = {
  prisma: PrismaClient;
  tokens: TokenService;
  tmdb: TmdbClient;
  webOrigin: string;
  region: string;
  logger?: boolean;
  rateLimitMax?: number;
  graceMs?: number;
  swipesPerSecond?: number;
  now?: () => Date;
};

const MovieParams = z.object({ id: z.coerce.number().int().positive() });
const CodeParams = z.object({ code: RoomCodeSchema });
const ProvidersQuery = z.object({ region: RegionSchema.optional() });

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export async function createServer(deps: ServerDeps) {
  const { prisma, tokens, tmdb, webOrigin, region } = deps;
  const rooms: RoomService = createRoomService({ prisma, tokens, tmdb, now: deps.now });
  const swipes: SwipeService = createSwipeService({ prisma });

  const app: FastifyInstance = Fastify({ logger: deps.logger ?? false });
  await app.register(cors, { origin: webOrigin });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(errorBody(err.code, err.message));
    if (err instanceof ZodError) return reply.status(400).send(errorBody('BAD_REQUEST', z.prettifyError(err)));
    if (err.statusCode === 429) return reply.status(429).send(errorBody('RATE_LIMITED', 'Too many requests, slow down'));
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send(errorBody('BAD_REQUEST', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(errorBody('INTERNAL', 'Something went wrong'));
  });

  const limited = { rateLimit: { max: deps.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  app.get('/health', async () => ({ ok: true }));

  app.post('/rooms', { config: limited }, async (req, reply) => {
    const { nickname, filters } = CreateRoomBodySchema.parse(req.body);
    return reply.status(201).send(await rooms.createRoom(nickname, filters));
  });

  app.post('/rooms/:code/join', { config: limited }, async (req, reply) => {
    const { code } = CodeParams.parse(req.params);
    const { nickname } = JoinRoomBodySchema.parse(req.body);
    return reply.status(201).send(await rooms.joinRoom(code, nickname));
  });

  app.get('/movies/:id', async (req) => tmdb.movie(MovieParams.parse(req.params).id));

  app.get('/movies/:id/providers', async (req) => {
    const { id } = MovieParams.parse(req.params);
    const query = ProvidersQuery.parse(req.query);
    return tmdb.providers(id, query.region ?? region);
  });

  const io: IO = new Server(app.server, { cors: { origin: webOrigin } });
  app.addHook('preClose', async () => {
    io.disconnectSockets(true);
  });

  return { app, io, rooms, swipes };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/routes.test.ts` (from `apps/api`)
Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/tests/routes.test.ts
git commit -m "feat: add fastify server with rooms and movies routes"
```

---

### Task 8: Realtime gateway

**Files:**
- Create: `apps/api/src/realtime/gateway.ts`, `apps/api/tests/helpers/server.ts`, `apps/api/tests/helpers/clients.ts`
- Modify: `apps/api/src/server.ts` (move `IO` type, call `attachRealtime`)
- Test: `apps/api/tests/realtime.test.ts`

**Interfaces:**
- Consumes: `RoomService`, `SwipeService`, `RoundOutcome`, `TokenService`, `SessionClaims`, `AppError`, shared schemas/types.
- Produces:
  - `type IO` (moved here from `server.ts`; `server.ts` re-exports it)
  - `attachRealtime(io: IO, deps: { tokens: TokenService; rooms: RoomService; swipes: SwipeService; logger: Pick<FastifyBaseLogger, 'error'>; graceMs?: number; swipesPerSecond?: number }): { close(): void }`
  - Handshake failure messages: `'ROOM_ENDED'` (bad/expired token, unknown or expired room), `'SERVER_ERROR'` (anything else).
  - Behavior: on connect → join `room:<id>`, cancel grace timer, mark active, broadcast per-socket `room:state`. When a member's last socket disconnects → after `graceMs`, if still no socket: mark inactive, `recheckMatches`, emit outcome, broadcast state.
  - Test helpers: `startTestServer(opts?: { decks?: number[][]; graceMs?: number; swipesPerSecond?: number })` → `{ app, prisma, url, close() }`; `createRoom(app, nickname)`, `joinRoom(app, code, nickname)`; `connectClient(url, token)` → `{ socket, state }`; `nextState(socket, match?)`; `nextEvent(socket, event)`; `closeAllClients()`; `sleep(ms)`.

- [ ] **Step 1: Write the test helpers**

`apps/api/tests/helpers/server.ts`:

```ts
import type { AddressInfo } from 'node:net';
import type { CreateRoomResponse, JoinRoomResponse } from '@mnm/shared';
import type { FastifyInstance } from 'fastify';
import { createTokenService } from '../../src/rooms/token';
import { createServer } from '../../src/server';
import { createTestPrisma } from './db';
import { stubTmdb, TEST_JWT_SECRET } from './fakes';

type Options = { decks?: number[][]; graceMs?: number; swipesPerSecond?: number };

export async function startTestServer(opts: Options = {}) {
  const prisma = createTestPrisma();
  const { app } = await createServer({
    prisma,
    tokens: createTokenService(TEST_JWT_SECRET),
    tmdb: stubTmdb(opts.decks),
    webOrigin: 'http://localhost:3000',
    region: 'IN',
    graceMs: opts.graceMs ?? 100,
    swipesPerSecond: opts.swipesPerSecond,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    prisma,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export async function createRoom(app: FastifyInstance, nickname: string): Promise<CreateRoomResponse> {
  const res = await app.inject({ method: 'POST', url: '/rooms', payload: { nickname } });
  return res.json();
}

export async function joinRoom(app: FastifyInstance, code: string, nickname: string): Promise<JoinRoomResponse> {
  const res = await app.inject({ method: 'POST', url: `/rooms/${code}/join`, payload: { nickname } });
  return res.json();
}
```

`apps/api/tests/helpers/clients.ts`:

```ts
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from '@mnm/shared';
import { io, type Socket } from 'socket.io-client';

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const EVENT_TIMEOUT_MS = 3000;
const open: TestClient[] = [];

export function connectClient(url: string, token: string): Promise<{ socket: TestClient; state: RoomState }> {
  return new Promise((resolve, reject) => {
    const socket: TestClient = io(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    open.push(socket);
    socket.once('room:state', (state) => resolve({ socket, state }));
    socket.once('connect_error', reject);
  });
}

export function nextState(socket: TestClient, match: (s: RoomState) => boolean = () => true): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for room:state')), EVENT_TIMEOUT_MS);
    const onState = (state: RoomState) => {
      if (!match(state)) return;
      clearTimeout(timer);
      socket.off('room:state', onState);
      resolve(state);
    };
    socket.on('room:state', onState);
  });
}

export function nextEvent(socket: TestClient, event: 'room:matched' | 'deck:exhausted' | 'swipe:progress'): Promise<unknown> {
  const raw = socket as unknown as Socket;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), EVENT_TIMEOUT_MS);
    raw.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function closeAllClients(): void {
  for (const socket of open.splice(0)) socket.disconnect();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

- [ ] **Step 2: Write the failing tests**

`apps/api/tests/realtime.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllClients, connectClient, nextEvent, nextState, sleep, type TestClient } from './helpers/clients';
import { resetDb } from './helpers/db';
import { createRoom, joinRoom, startTestServer } from './helpers/server';

type TestServer = Awaited<ReturnType<typeof startTestServer>>;
let server: TestServer | undefined;

async function boot(opts?: Parameters<typeof startTestServer>[0]) {
  server = await startTestServer(opts);
  await resetDb(server.prisma);
  return server;
}

afterEach(async () => {
  closeAllClients();
  await server?.close();
  server = undefined;
});

/** Host "ana" plus the given guests, all connected. */
async function roomWith(srv: TestServer, guests: string[]) {
  const host = await createRoom(srv.app, 'ana');
  const clients: Record<string, TestClient> = { ana: (await connectClient(srv.url, host.token)).socket };
  const tokens: Record<string, string> = { ana: host.token };
  for (const nickname of guests) {
    const { token } = await joinRoom(srv.app, host.code, nickname);
    tokens[nickname] = token;
    clients[nickname] = (await connectClient(srv.url, token)).socket;
  }
  return { code: host.code, clients, tokens };
}

async function startSwiping(clients: Record<string, TestClient>) {
  const ready = Object.values(clients).map((c) => nextState(c, (s) => s.status === 'SWIPING'));
  expect(await clients.ana!.emitWithAck('room:start', {})).toEqual({ ok: true, data: null });
  return Promise.all(ready);
}

describe('handshake', () => {
  it('refuses missing and invalid tokens with ROOM_ENDED', async () => {
    const srv = await boot();
    await expect(connectClient(srv.url, '')).rejects.toThrow('ROOM_ENDED');
    await expect(connectClient(srv.url, 'garbage')).rejects.toThrow('ROOM_ENDED');
  });

  it('sends the joining client a snapshot and refreshes everyone else', async () => {
    const srv = await boot();
    const host = await createRoom(srv.app, 'ana');
    const ana = (await connectClient(srv.url, host.token)).socket;
    const anaSeesBen = nextState(ana, (s) => s.members.some((m) => m.nickname === 'ben'));
    const { token } = await joinRoom(srv.app, host.code, 'ben');
    const { state } = await connectClient(srv.url, token);
    expect(state).toMatchObject({ status: 'LOBBY', position: 0 });
    expect((await anaSeesBen).members.map((m) => m.nickname)).toEqual(['ana', 'ben']);
  });
});

describe('swiping', () => {
  it('plays a room from start to match', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben', 'cal']);
    const states = await startSwiping(clients);
    expect(states.every((s) => s.deck.join() === '11,22,33' && s.position === 0)).toBe(true);

    const matched = Object.values(clients).map((c) => nextEvent(c, 'room:matched'));
    expect(await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true })).toEqual({
      ok: true,
      data: { movieId: 11, likes: 1, needed: 3 },
    });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });
    await clients.cal!.emitWithAck('swipe', { movieId: 11, liked: true });
    expect(await Promise.all(matched)).toEqual([{ movieId: 11 }, { movieId: 11 }, { movieId: 11 }]);
  });

  it('broadcasts progress counts to the room', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const progress = nextEvent(clients.ben!, 'swipe:progress');
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    expect(await progress).toEqual({ movieId: 11, likes: 1, needed: 2 });
  });

  it('rejects non-hosts starting and bad payloads without disconnecting', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    expect(await clients.ben!.emitWithAck('room:start', {})).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    const bad = await clients.ana!.emitWithAck('swipe', { movieId: 'x' } as never);
    expect(bad).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(clients.ana!.connected).toBe(true);
  });

  it('room:sync returns the caller snapshot', async () => {
    const srv = await boot();
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: false });
    expect(await clients.ben!.emitWithAck('room:sync', {})).toMatchObject({ ok: true, data: { position: 1 } });
  });

  it('announces an exhausted deck and lets the host load the next page', async () => {
    const srv = await boot({ decks: [[11], [44, 55]] });
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const exhausted = nextEvent(clients.ben!, 'deck:exhausted');
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: false });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: false });
    await exhausted;

    const fresh = nextState(clients.ben!, (s) => s.deck.join() === '44,55');
    expect(await clients.ana!.emitWithAck('room:restart', {})).toEqual({ ok: true, data: null });
    expect(await fresh).toMatchObject({ position: 0, exhausted: false });
  });

  it('throttles swipe floods per socket', async () => {
    const srv = await boot({ swipesPerSecond: 2 });
    const { clients } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    const send = () => clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    await send();
    await send();
    expect(await send()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('presence', () => {
  it('resumes at the right card after a reconnect', async () => {
    const srv = await boot();
    const { clients, tokens } = await roomWith(srv, ['ben']);
    await startSwiping(clients);
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });
    clients.ben!.disconnect();
    const { state } = await connectClient(srv.url, tokens.ben!);
    expect(state.position).toBe(1);
  });

  it('marks a member inactive after the grace period and completes a pending match', async () => {
    const srv = await boot({ graceMs: 100 });
    const { clients } = await roomWith(srv, ['ben', 'cal']);
    await startSwiping(clients);
    await clients.ana!.emitWithAck('swipe', { movieId: 11, liked: true });
    await clients.ben!.emitWithAck('swipe', { movieId: 11, liked: true });

    const matched = nextEvent(clients.ana!, 'room:matched');
    const calGone = nextState(clients.ana!, (s) => s.members.some((m) => m.nickname === 'cal' && !m.isActive));
    clients.cal!.disconnect();
    expect(await matched).toEqual({ movieId: 11 });
    await calGone;
  });

  it('keeps a member active when they reconnect within the grace period', async () => {
    const srv = await boot({ graceMs: 200 });
    const { clients, tokens } = await roomWith(srv, ['ben']);
    clients.ben!.disconnect();
    await connectClient(srv.url, tokens.ben!);
    await sleep(350);
    const ben = await srv.prisma.member.findFirstOrThrow({ where: { nickname: 'ben' } });
    expect(ben.isActive).toBe(true);
  });

  it('keeps a member active while another tab is still open', async () => {
    const srv = await boot({ graceMs: 100 });
    const { clients, tokens } = await roomWith(srv, ['ben']);
    await connectClient(srv.url, tokens.ben!);
    clients.ben!.disconnect();
    await sleep(250);
    const ben = await srv.prisma.member.findFirstOrThrow({ where: { nickname: 'ben' } });
    expect(ben.isActive).toBe(true);
  });

  it('room:leave deactivates immediately and hands off host', async () => {
    const srv = await boot({ graceMs: 10_000 });
    const { clients } = await roomWith(srv, ['ben']);
    const benIsHost = nextState(clients.ben!, (s) => s.members.some((m) => m.nickname === 'ben' && m.isHost));
    expect(await clients.ana!.emitWithAck('room:leave', {})).toEqual({ ok: true, data: null });
    const state = await benIsHost;
    expect(state.members.find((m) => m.nickname === 'ana')?.isActive).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/realtime.test.ts` (from `apps/api`)
Expected: FAIL — `connectClient` times out (no gateway sends `room:state` yet) and the handshake tests resolve instead of rejecting.

- [ ] **Step 4: Implement the gateway and wire it into the server**

`apps/api/src/realtime/gateway.ts`:

```ts
import {
  type Ack,
  type ClientToServerEvents,
  RestartEventSchema,
  type ServerToClientEvents,
  SwipeEventSchema,
} from '@mnm/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { AppError } from '../errors';
import type { RoomService } from '../rooms/service';
import type { SessionClaims, TokenService } from '../rooms/token';
import type { RoundOutcome, SwipeService } from '../swipes/service';

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SessionClaims>;

export type RealtimeDeps = {
  tokens: TokenService;
  rooms: RoomService;
  swipes: SwipeService;
  logger: Pick<FastifyBaseLogger, 'error'>;
  graceMs?: number;
  swipesPerSecond?: number;
};

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_SWIPES_PER_SECOND = 10;
const RATE_WINDOW_MS = 1000;
const EmptyPayload = z.object({});

const channel = (roomId: string) => `room:${roomId}`;

function createRateLimiter(maxPerWindow: number) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count > maxPerWindow;
  };
}

export function attachRealtime(io: IO, deps: RealtimeDeps): { close(): void } {
  const { tokens, rooms, swipes, logger } = deps;
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const swipesPerSecond = deps.swipesPerSecond ?? DEFAULT_SWIPES_PER_SECOND;
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let isClosed = false;

  function toErrorBody(err: unknown) {
    if (err instanceof AppError) return { error: { code: err.code, message: err.message } };
    if (err instanceof ZodError) return { error: { code: 'BAD_REQUEST', message: z.prettifyError(err) } };
    logger.error({ err }, 'socket handler failed');
    return { error: { code: 'INTERNAL', message: 'Something went wrong' } };
  }

  function handler<P, R>(schema: z.ZodType<P>, fn: (payload: P) => Promise<R>) {
    return async (raw: unknown, ack?: (res: Ack<R>) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, data: await fn(schema.parse(raw ?? {})) });
      } catch (err) {
        reply({ ok: false, ...toErrorBody(err) });
      }
    };
  }

  async function hasLiveSocket(roomId: string, memberId: string): Promise<boolean> {
    const sockets = await io.in(channel(roomId)).fetchSockets();
    return sockets.some((s) => s.data.memberId === memberId);
  }

  async function broadcastState(roomId: string): Promise<void> {
    // ponytail: one snapshot query per socket; fine at ≤10 members, share the room part if rooms grow
    const sockets = await io.in(channel(roomId)).fetchSockets();
    await Promise.all(
      sockets.map(async (s) => s.emit('room:state', await rooms.getSnapshot(roomId, s.data.memberId))),
    );
  }

  function emitOutcome(roomId: string, { matched, exhausted }: RoundOutcome): void {
    if (matched !== null) io.to(channel(roomId)).emit('room:matched', { movieId: matched });
    else if (exhausted) io.to(channel(roomId)).emit('deck:exhausted');
  }

  async function deactivate(roomId: string, memberId: string): Promise<void> {
    if (!(await rooms.setMemberActive(roomId, memberId, false))) return;
    emitOutcome(roomId, await swipes.recheckMatches(roomId));
    await broadcastState(roomId);
  }

  function scheduleDeactivation(roomId: string, memberId: string): void {
    graceTimers.set(
      memberId,
      setTimeout(() => {
        graceTimers.delete(memberId);
        void (async () => {
          // a new tab may have connected while the timer ran
          if (isClosed || (await hasLiveSocket(roomId, memberId))) return;
          await deactivate(roomId, memberId);
        })().catch((err) => logger.error({ err, roomId, memberId }, 'deactivate failed'));
      }, graceMs),
    );
  }

  io.use(async (socket, next) => {
    try {
      const token = z.string().min(1).parse(socket.handshake.auth?.token);
      const claims = await tokens.verify(token);
      await rooms.getSnapshot(claims.roomId, claims.memberId);
      socket.data = claims;
      next();
    } catch (err) {
      const isEnded = err instanceof ZodError || (err instanceof AppError && (err.status === 401 || err.status === 410));
      if (!isEnded) logger.error({ err }, 'socket handshake failed');
      next(new Error(isEnded ? 'ROOM_ENDED' : 'SERVER_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    const { roomId, memberId } = socket.data;
    const isRateLimited = createRateLimiter(swipesPerSecond);

    socket.on('room:start', handler(EmptyPayload, async () => {
      await rooms.startRoom(roomId, memberId);
      await broadcastState(roomId);
      return null;
    }));

    socket.on('room:restart', handler(RestartEventSchema, async ({ filters }) => {
      await rooms.restartRoom(roomId, memberId, filters);
      await broadcastState(roomId);
      return null;
    }));

    socket.on('swipe', handler(SwipeEventSchema, async ({ movieId, liked }) => {
      if (isRateLimited()) throw new AppError(429, 'RATE_LIMITED', 'Slow down a little');
      const result = await swipes.recordSwipe({ roomId, memberId, movieId, liked });
      const progress = { movieId, likes: result.likes, needed: result.needed };
      io.to(channel(roomId)).emit('swipe:progress', progress);
      emitOutcome(roomId, result);
      return progress;
    }));

    socket.on('room:sync', handler(EmptyPayload, () => rooms.getSnapshot(roomId, memberId)));

    socket.on('room:leave', handler(EmptyPayload, async () => {
      await deactivate(roomId, memberId);
      setImmediate(() => socket.disconnect(true));
      return null;
    }));

    socket.on('disconnect', async () => {
      try {
        if (isClosed || (await hasLiveSocket(roomId, memberId))) return;
        scheduleDeactivation(roomId, memberId);
      } catch (err) {
        logger.error({ err, roomId, memberId }, 'disconnect handling failed');
      }
    });

    clearTimeout(graceTimers.get(memberId));
    graceTimers.delete(memberId);
    void socket.join(channel(roomId));
    rooms
      .setMemberActive(roomId, memberId, true)
      .then(() => broadcastState(roomId))
      .catch((err) => {
        logger.error({ err, roomId, memberId }, 'connect handling failed');
        socket.disconnect(true);
      });
  });

  return {
    close() {
      isClosed = true;
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
    },
  };
}
```

Modify `apps/api/src/server.ts`:
1. Delete the local `export type IO = …` line and the now-unused `ClientToServerEvents`, `ServerToClientEvents` and `SessionClaims` imports. Change the token import to `import type { TokenService } from './rooms/token';`. Add `import { attachRealtime, type IO } from './realtime/gateway';` and `export type { IO } from './realtime/gateway';`.
2. Replace the Socket.IO block at the end of `createServer` with:

```ts
  const io: IO = new Server(app.server, { cors: { origin: webOrigin } });
  const realtime = attachRealtime(io, {
    tokens,
    rooms,
    swipes,
    logger: app.log,
    graceMs: deps.graceMs,
    swipesPerSecond: deps.swipesPerSecond,
  });
  app.addHook('preClose', async () => {
    realtime.close();
    io.disconnectSockets(true);
  });

  return { app, io, rooms, swipes };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/realtime.test.ts tests/routes.test.ts && npm run typecheck -w @mnm/api` (from `apps/api`, typecheck from root)
Expected: 13 realtime + 12 routes tests PASS; vitest exits without hanging; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/realtime apps/api/src/server.ts apps/api/tests/realtime.test.ts apps/api/tests/helpers/server.ts apps/api/tests/helpers/clients.ts
git commit -m "feat: add socket.io gateway with presence and resync"
```

---

### Task 9: Cleanup job and process entrypoint

**Files:**
- Create: `apps/api/src/cleanup.ts`, `apps/api/src/index.ts`
- Test: `apps/api/tests/cleanup.test.ts`

**Interfaces:**
- Consumes: `ROOM_TTL_MS`, `PrismaClient`, `createServer`, `loadEnv`, `createPrisma`, `createTokenService`, `createTmdbClient`.
- Produces: `deleteExpiredRooms(prisma: PrismaClient, now?: Date): Promise<number>`; `startCleanup(deps: { prisma: PrismaClient; logger: Pick<FastifyBaseLogger, 'info' | 'error'>; intervalMs?: number }): () => void` (returns stop function); runnable `src/index.ts`.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/cleanup.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteExpiredRooms, startCleanup } from '../src/cleanup';
import { ROOM_TTL_MS } from '../src/rooms/service';
import { createTestPrisma, resetDb } from './helpers/db';
import { seedRoom } from './helpers/seed';

const prisma = createTestPrisma();
beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('deleteExpiredRooms', () => {
  it('deletes rooms past the TTL with their members and swipes, keeping fresh ones', async () => {
    const old = await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 60_000) });
    await prisma.swipe.create({ data: { roomId: old.roomId, memberId: old.memberIds[0]!, movieId: 11, liked: true } });
    const fresh = await seedRoom(prisma);

    expect(await deleteExpiredRooms(prisma)).toBe(1);
    expect(await prisma.room.findMany({ select: { id: true } })).toEqual([{ id: fresh.roomId }]);
    expect(await prisma.member.count({ where: { roomId: old.roomId } })).toBe(0);
    expect(await prisma.swipe.count()).toBe(0);
  });
});

describe('startCleanup', () => {
  it('runs immediately, logs deletions, and stops cleanly', async () => {
    await seedRoom(prisma, { createdAt: new Date(Date.now() - ROOM_TTL_MS - 60_000) });
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = startCleanup({ prisma, logger, intervalMs: 60_000 });
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith({ deleted: 1 }, 'expired rooms deleted'));
    stop();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cleanup.test.ts` (from `apps/api`)
Expected: FAIL, cannot resolve `../src/cleanup`.

- [ ] **Step 3: Implement cleanup and the entrypoint**

`apps/api/src/cleanup.ts`:

```ts
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
```

`apps/api/src/index.ts`:

```ts
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
```

- [ ] **Step 4: Run all API tests, coverage and typecheck**

Run: `npm run test:coverage -w @mnm/api && npm run typecheck -w @mnm/api`
Expected: every test PASSES, coverage thresholds met (lines ≥ 80%), `tsc` exits 0.

- [ ] **Step 5: Smoke-test the real server**

Run `npm run dev:api` in one terminal, then in another:

```bash
curl -s localhost:4000/health
curl -s -XPOST localhost:4000/rooms -H 'content-type: application/json' -d '{"nickname":"ana","filters":{"language":"hi"}}'
curl -s localhost:4000/movies/550
```

Expected: `{"ok":true}`, a `{"code":"…","token":"…"}` body, and a real movie card for Fight Club (proves the TMDB key works). Stop the server with Ctrl+C and confirm it logs `shutting down`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/cleanup.ts apps/api/src/index.ts apps/api/tests/cleanup.test.ts
git commit -m "feat: add expired room cleanup and api entrypoint"
```

---

### Task 10: Web foundation — Next.js app, API client, session, room state

**Files:**
- Create (generator): `apps/web/*` via `create-next-app`
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`
- Create: `apps/web/vitest.config.ts`, `apps/web/.env.example`, `apps/web/lib/api.ts`, `apps/web/lib/session.ts`, `apps/web/lib/roomReducer.ts`, `apps/web/lib/useRoom.ts`
- Test: `apps/web/lib/api.test.ts`, `apps/web/lib/roomReducer.test.ts`

**Interfaces:**
- Consumes: `@mnm/shared` types; API routes and socket events from Tasks 7–8.
- Produces:
  - `API_URL: string`; `class ApiError extends Error { status: number; code: string }`; `api = { createRoom(nickname, filters): Promise<CreateRoomResponse>; joinRoom(code, nickname): Promise<JoinRoomResponse>; movie(id): Promise<MovieCard>; providers(id, region?): Promise<Providers> }`
  - `loadSession(code): string | null`, `saveSession(code, token): void`, `clearSession(code): void`
  - `type RoomView = { state: RoomState | null; progress: Record<number, SwipeProgress>; connection: 'connecting' | 'open' | 'ended'; error: string | null }`; `initialRoomView`; `roomReducer(view, action): RoomView`; `RESYNC_CODES: ReadonlySet<string>`
  - `useRoom(token: string): { view: RoomView; actions: { start(): Promise<void>; restart(): Promise<void>; swipe(movieId: number, liked: boolean): Promise<void>; leave(): Promise<void> } }`

- [ ] **Step 1: Generate the Next.js app**

```bash
cd ~/Desktop/movie-night-matcher
npx create-next-app@16 apps/web --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --skip-install --yes
```

Expected: `apps/web` contains `app/`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `tsconfig.json`. If the generator created `apps/web/.git`, delete that folder (the repo root owns git).

Edit `apps/web/package.json`: set `"name": "@mnm/web"`, add `"@mnm/shared": "*"` to `dependencies`, pin `"typescript": "~6.0.3"` in `devDependencies`, and set scripts to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "next typegen && tsc --noEmit",
  "test": "vitest run",
  "e2e": "playwright test"
}
```

Replace `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@mnm/shared'],
};

export default nextConfig;
```

`apps/web/.env.example` (copy to `apps/web/.env.local`):

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['lib/**/*.test.ts'] } });
```

Install (from repo root): `npm install && npm i -w @mnm/web socket.io-client@^4.8 motion && npm i -D -w @mnm/web @playwright/test`
Expected: installs cleanly; `npm run build -w @mnm/web` succeeds on the starter page.

- [ ] **Step 2: Write the failing tests**

`apps/web/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  it('posts JSON and returns the parsed body', async () => {
    const fetchSpy = respond(201, { code: 'ABCDEF', token: 't' });
    expect(await api.createRoom('ana', { genres: [], providers: [] })).toEqual({ code: 'ABCDEF', token: 't' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:4000/rooms');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ nickname: 'ana', filters: { genres: [], providers: [] } }) });
  });

  it('surfaces the server error code and message', async () => {
    respond(409, { error: { code: 'NICKNAME_TAKEN', message: 'Someone in this room already uses that nickname' } });
    await expect(api.joinRoom('ABCDEF', 'ana')).rejects.toEqual(
      expect.objectContaining({ status: 409, code: 'NICKNAME_TAKEN', message: 'Someone in this room already uses that nickname' }),
    );
  });

  it('falls back to a generic message for non-JSON errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(api.movie(1)).rejects.toMatchObject({ status: 502, code: 'UNKNOWN', message: 'Something went wrong' });
  });

  it('turns network failures into a friendly ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const err = await api.movie(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('url-encodes the room code', async () => {
    const fetchSpy = respond(201, { token: 't' });
    await api.joinRoom('AB/CD', 'ana');
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('http://localhost:4000/rooms/AB%2FCD/join');
  });
});
```

`apps/web/lib/roomReducer.test.ts`:

```ts
import type { RoomState } from '@mnm/shared';
import { describe, expect, it } from 'vitest';
import { initialRoomView, RESYNC_CODES, roomReducer, type RoomView } from './roomReducer';

const state = (overrides: Partial<RoomState> = {}): RoomState => ({
  code: 'ABCDEF',
  status: 'SWIPING',
  filters: { genres: [], providers: [] },
  members: [],
  deck: [11, 22, 33],
  position: 0,
  matchedMovieId: null,
  exhausted: false,
  me: 'm1',
  ...overrides,
});

const withState = (s: RoomState): RoomView => ({ ...initialRoomView, state: s });

describe('roomReducer', () => {
  it('stores a snapshot', () => {
    expect(roomReducer(initialRoomView, { type: 'state', state: state() }).state).toEqual(state());
  });

  it('keeps progress across snapshots of the same deck but resets it for a new deck', () => {
    const view = { ...withState(state()), progress: { 11: { movieId: 11, likes: 1, needed: 2 } } };
    expect(roomReducer(view, { type: 'state', state: state({ position: 1 }) }).progress).toHaveProperty('11');
    expect(roomReducer(view, { type: 'state', state: state({ deck: [44] }) }).progress).toEqual({});
  });

  it('records progress immutably', () => {
    const view = withState(state());
    const next = roomReducer(view, { type: 'progress', progress: { movieId: 11, likes: 1, needed: 2 } });
    expect(next.progress[11]).toEqual({ movieId: 11, likes: 1, needed: 2 });
    expect(view.progress).toEqual({});
  });

  it('advances optimistically only for the current card', () => {
    const view = withState(state());
    expect(roomReducer(view, { type: 'swiped', movieId: 11 }).state?.position).toBe(1);
    expect(roomReducer(view, { type: 'swiped', movieId: 22 })).toBe(view);
  });

  it('applies match and exhaustion events', () => {
    const view = withState(state());
    expect(roomReducer(view, { type: 'matched', movieId: 22 }).state).toMatchObject({ status: 'MATCHED', matchedMovieId: 22 });
    expect(roomReducer(view, { type: 'exhausted' }).state?.exhausted).toBe(true);
  });

  it('ignores match and swipe events before the first snapshot', () => {
    expect(roomReducer(initialRoomView, { type: 'matched', movieId: 1 })).toBe(initialRoomView);
    expect(roomReducer(initialRoomView, { type: 'swiped', movieId: 1 })).toBe(initialRoomView);
  });

  it('tracks connection and error', () => {
    const open = roomReducer(initialRoomView, { type: 'connection', connection: 'open' });
    expect(open.connection).toBe('open');
    expect(roomReducer(open, { type: 'error', message: 'oops' }).error).toBe('oops');
  });
});

describe('RESYNC_CODES', () => {
  it('covers every server code that means the client view is stale', () => {
    for (const code of ['NOT_IN_DECK', 'OUT_OF_ORDER', 'ROOM_NOT_SWIPING', 'MEMBER_INACTIVE']) {
      expect(RESYNC_CODES.has(code)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @mnm/web`
Expected: FAIL, cannot resolve `./api` and `./roomReducer`.

- [ ] **Step 4: Implement the API client, session store and reducer**

`apps/web/lib/api.ts`:

```ts
import type { CreateRoomResponse, Filters, JoinRoomResponse, MovieCard, Providers } from '@mnm/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server, check your connection");
  }
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Something went wrong');
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  createRoom: (nickname: string, filters: Filters) => call<CreateRoomResponse>('/rooms', post({ nickname, filters })),
  joinRoom: (code: string, nickname: string) =>
    call<JoinRoomResponse>(`/rooms/${encodeURIComponent(code)}/join`, post({ nickname })),
  movie: (id: number) => call<MovieCard>(`/movies/${id}`),
  providers: (id: number, region = 'IN') => call<Providers>(`/movies/${id}/providers?region=${region}`),
};
```

`apps/web/lib/session.ts`:

```ts
const key = (code: string) => `mnm:session:${code}`;

export function loadSession(code: string): string | null {
  try {
    return localStorage.getItem(key(code));
  } catch {
    return null; // storage blocked (private mode): the visitor joins again
  }
}

export function saveSession(code: string, token: string): void {
  try {
    localStorage.setItem(key(code), token);
  } catch {
    // storage blocked: the session lives only as long as this tab's React state
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    // storage blocked: nothing was stored
  }
}
```

`apps/web/lib/roomReducer.ts`:

```ts
import type { RoomState, SwipeProgress } from '@mnm/shared';

export type Connection = 'connecting' | 'open' | 'ended';

export type RoomView = {
  state: RoomState | null;
  progress: Record<number, SwipeProgress>;
  connection: Connection;
  error: string | null;
};

export type RoomAction =
  | { type: 'state'; state: RoomState }
  | { type: 'progress'; progress: SwipeProgress }
  | { type: 'matched'; movieId: number }
  | { type: 'exhausted' }
  | { type: 'swiped'; movieId: number }
  | { type: 'connection'; connection: Connection }
  | { type: 'error'; message: string | null };

/** Server error codes meaning "your view is stale": refetch the snapshot instead of showing an error. */
export const RESYNC_CODES: ReadonlySet<string> = new Set(['NOT_IN_DECK', 'OUT_OF_ORDER', 'ROOM_NOT_SWIPING', 'MEMBER_INACTIVE']);

export const initialRoomView: RoomView = { state: null, progress: {}, connection: 'connecting', error: null };

const sameDeck = (a: number[] | undefined, b: number[]) => a?.length === b.length && a.every((id, i) => id === b[i]);

export function roomReducer(view: RoomView, action: RoomAction): RoomView {
  switch (action.type) {
    case 'state':
      return {
        ...view,
        state: action.state,
        progress: sameDeck(view.state?.deck, action.state.deck) ? view.progress : {},
      };
    case 'progress':
      return { ...view, progress: { ...view.progress, [action.progress.movieId]: action.progress } };
    case 'matched':
      return view.state
        ? { ...view, state: { ...view.state, status: 'MATCHED', matchedMovieId: action.movieId } }
        : view;
    case 'exhausted':
      return view.state ? { ...view, state: { ...view.state, exhausted: true } } : view;
    case 'swiped':
      if (!view.state || view.state.deck[view.state.position] !== action.movieId) return view;
      return { ...view, state: { ...view.state, position: view.state.position + 1 } };
    case 'connection':
      return { ...view, connection: action.connection };
    case 'error':
      return { ...view, error: action.message };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @mnm/web`
Expected: 13 tests PASS.

- [ ] **Step 6: Implement the socket hook**

`apps/web/lib/useRoom.ts`:

```ts
'use client';

import type { Ack, ClientToServerEvents, RoomState, ServerToClientEvents } from '@mnm/shared';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { initialRoomView, RESYNC_CODES, roomReducer } from './roomReducer';

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 8000;

export function useRoom(token: string) {
  const [view, dispatch] = useReducer(roomReducer, initialRoomView);
  const socketRef = useRef<RoomSocket | null>(null);

  useEffect(() => {
    const socket: RoomSocket = io(API_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => dispatch({ type: 'connection', connection: 'open' }));
    socket.on('disconnect', () => dispatch({ type: 'connection', connection: 'connecting' }));
    socket.on('connect_error', (err) => {
      if (err.message !== 'ROOM_ENDED') return; // transient: socket.io keeps retrying
      dispatch({ type: 'connection', connection: 'ended' });
      socket.disconnect();
    });
    socket.on('room:state', (state) => dispatch({ type: 'state', state }));
    socket.on('swipe:progress', (progress) => dispatch({ type: 'progress', progress }));
    socket.on('room:matched', ({ movieId }) => dispatch({ type: 'matched', movieId }));
    socket.on('deck:exhausted', () => dispatch({ type: 'exhausted' }));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const actions = useMemo(() => {
    const connected = (): RoomSocket | null => {
      const socket = socketRef.current;
      if (socket?.connected) return socket;
      dispatch({ type: 'error', message: 'Reconnecting… try again in a moment' });
      return null;
    };

    async function resync(socket: RoomSocket) {
      const res: Ack<RoomState> = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('room:sync', {});
      if (res.ok) dispatch({ type: 'state', state: res.data });
    }

    async function settle<T>(socket: RoomSocket, pending: Promise<Ack<T>>): Promise<void> {
      try {
        const res = await pending;
        if (res.ok) {
          dispatch({ type: 'error', message: null });
        } else if (RESYNC_CODES.has(res.error.code)) {
          await resync(socket);
        } else {
          dispatch({ type: 'error', message: res.error.message });
        }
      } catch {
        dispatch({ type: 'error', message: 'The server did not respond, try again' });
      }
    }

    return {
      async start() {
        const s = connected();
        if (s) await settle(s, s.timeout(ACK_TIMEOUT_MS).emitWithAck('room:start', {}));
      },
      async restart() {
        const s = connected();
        if (s) await settle(s, s.timeout(ACK_TIMEOUT_MS).emitWithAck('room:restart', {}));
      },
      async swipe(movieId: number, liked: boolean) {
        const s = connected();
        if (!s) return;
        dispatch({ type: 'swiped', movieId });
        await settle(s, s.timeout(ACK_TIMEOUT_MS).emitWithAck('swipe', { movieId, liked }));
      },
      async leave() {
        const s = connected();
        if (s) await settle(s, s.timeout(ACK_TIMEOUT_MS).emitWithAck('room:leave', {}));
      },
    };
  }, []);

  return { view, actions };
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck -w @mnm/web && npm run lint -w @mnm/web`
Expected: both exit 0. If `tsc` reports `Cannot find name 'process'` (TS 6 defaults `types` to `[]`), add `"types": ["node"]` to `compilerOptions` in `apps/web/tsconfig.json` and rerun.

- [ ] **Step 8: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat: add next.js app with api client and room state hook"
```

---

### Task 11: Web home page — create and join

**Files:**
- Create: `apps/web/lib/catalog.ts`, `apps/web/components/TextField.tsx`, `apps/web/components/ChipGroup.tsx`, `apps/web/components/CreateRoomForm.tsx`, `apps/web/components/JoinRoomForm.tsx`
- Modify (replace): `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `api`, `ApiError`, `saveSession` (Task 10); `RoomCodeSchema` from `@mnm/shared`.
- Produces: `type Option`, `GENRES`, `LANGUAGES`, `PROVIDERS`; `<TextField label …inputProps/>`; `<ChipGroup label options selected onChange/>`; `<CreateRoomForm/>`; `<JoinRoomForm initialCode? onJoined(code, token)/>`. Forms carry `aria-label` "Start a room" / "Join a room" (E2E selectors); nickname inputs are labelled "Your nickname"; buttons "Create room" / "Join room".

- [ ] **Step 1: Verify TMDB provider ids for India**

Run (with `TMDB_API_KEY` exported in your shell): `curl -s "https://api.themoviedb.org/3/watch/providers/movie?watch_region=IN&api_key=$TMDB_API_KEY" | node -e 'const r=JSON.parse(require("fs").readFileSync(0)).results;for(const p of r)if(/Netflix|Prime Video|Hotstar|Zee5|Sony/i.test(p.provider_name))console.log(p.provider_id,p.provider_name)'`
Expected: lines like `8 Netflix`, `119 Amazon Prime Video`, `<id> JioHotstar`. Use the printed ids in `PROVIDERS` below (replace any that differ).

- [ ] **Step 2: Add the catalog and form primitives**

`apps/web/lib/catalog.ts`:

```ts
export type Option = { id: number; name: string };

export const GENRES: readonly Option[] = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 53, name: 'Thriller' },
  { id: 27, name: 'Horror' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 80, name: 'Crime' },
  { id: 16, name: 'Animation' },
  { id: 14, name: 'Fantasy' },
  { id: 10751, name: 'Family' },
  { id: 99, name: 'Documentary' },
];

export const LANGUAGES = [
  { code: '', name: 'Any language' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'ko', name: 'Korean' },
  { code: 'ja', name: 'Japanese' },
] as const;

/** TMDB watch-provider ids for region IN (verified with /watch/providers/movie?watch_region=IN). */
export const PROVIDERS: readonly Option[] = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 2336, name: 'JioHotstar' },
];
```

`apps/web/components/TextField.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';

type Props = { label: string } & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, className = '', ...input }: Props) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-zinc-400">{label}</span>
      <input
        {...input}
        className={`w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-amber-400 ${className}`}
      />
    </label>
  );
}
```

`apps/web/components/ChipGroup.tsx`:

```tsx
import type { Option } from '@/lib/catalog';

type Props = {
  label: string;
  options: readonly Option[];
  selected: number[];
  onChange: (next: number[]) => void;
};

export function ChipGroup({ label, options, selected, onChange }: Props) {
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset>
      <legend className="mb-2 text-sm text-zinc-400">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(option.id)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                isOn ? 'border-amber-400 bg-amber-400 text-zinc-950' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: Add the forms**

`apps/web/components/CreateRoomForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { GENRES, LANGUAGES, PROVIDERS } from '@/lib/catalog';
import { saveSession } from '@/lib/session';
import { ChipGroup } from './ChipGroup';
import { TextField } from './TextField';

export function CreateRoomForm() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [genres, setGenres] = useState<number[]>([]);
  const [language, setLanguage] = useState('');
  const [providers, setProviders] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      const { code, token } = await api.createRoom(nickname, { genres, providers, ...(language ? { language } : {}) });
      saveSession(code, token);
      router.push(`/room/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setIsBusy(false);
    }
  }

  return (
    <form aria-label="Start a room" onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="text-xl font-semibold">Start a room</h2>
      <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required />
      <ChipGroup label="Genres (leave empty for any)" options={GENRES} selected={genres} onChange={setGenres} />
      <label className="block">
        <span className="mb-1.5 block text-sm text-zinc-400">Language</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <ChipGroup label="Only on (leave empty for anywhere)" options={PROVIDERS} selected={providers} onChange={setProviders} />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="w-full rounded-lg bg-amber-400 py-2.5 font-medium text-zinc-950 transition hover:bg-amber-300 disabled:opacity-60"
      >
        {isBusy ? 'Creating…' : 'Create room'}
      </button>
    </form>
  );
}
```

`apps/web/components/JoinRoomForm.tsx`:

```tsx
'use client';

import { RoomCodeSchema } from '@mnm/shared';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { TextField } from './TextField';

type Props = { initialCode?: string; onJoined: (code: string, token: string) => void };

export function JoinRoomForm({ initialCode = '', onJoined }: Props) {
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = RoomCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('Room codes are 6 letters or digits');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const { token } = await api.joinRoom(parsed.data, nickname);
      onJoined(parsed.data, token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setIsBusy(false);
    }
  }

  return (
    <form aria-label="Join a room" onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="text-xl font-semibold">Join a room</h2>
      {initialCode ? (
        <p className="text-sm text-zinc-400">
          Room <span className="font-mono text-zinc-100">{initialCode}</span>
        </p>
      ) : (
        <TextField
          label="Room code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          autoCapitalize="characters"
          className="font-mono uppercase tracking-widest"
          required
        />
      )}
      <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="w-full rounded-lg border border-amber-400 py-2.5 font-medium text-amber-400 transition hover:bg-amber-400/10 disabled:opacity-60"
      >
        {isBusy ? 'Joining…' : 'Join room'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Replace layout, page and styles**

`apps/web/app/globals.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
}
```

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Movie Night Matcher',
  description: 'Swipe together. The first movie everyone likes wins.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100 antialiased">
        <div className="flex-1">{children}</div>
        <footer className="px-4 py-6 text-center text-xs text-zinc-500">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { CreateRoomForm } from '@/components/CreateRoomForm';
import { JoinRoomForm } from '@/components/JoinRoomForm';
import { saveSession } from '@/lib/session';

export default function Home() {
  const router = useRouter();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">Movie Night Matcher</h1>
        <p className="mt-3 text-zinc-400">Swipe together. The first movie everyone likes wins.</p>
      </header>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <CreateRoomForm />
        <JoinRoomForm
          onJoined={(code, token) => {
            saveSession(code, token);
            router.push(`/room/${code}`);
          }}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Check it in the browser**

Run `npm run dev:api` and `npm run dev:web`, open http://localhost:3000. Create a room with a nickname: the URL changes to `/room/XXXXXX` (that page 404s until Task 12). Submit an empty nickname: browser validation blocks it. Join with code `zzzzzz`: shows "No room with that code".
Then run: `npm run typecheck -w @mnm/web && npm run lint -w @mnm/web` — both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add home page with create and join forms"
```

---

### Task 12: Web room screens — lobby, swipe deck, match

**Files:**
- Create: `apps/web/lib/useMovie.ts`, `apps/web/app/room/[code]/page.tsx`, `apps/web/components/RoomClient.tsx`, `apps/web/components/RoomScreen.tsx`, `apps/web/components/Notice.tsx`, `apps/web/components/Lobby.tsx`, `apps/web/components/MovieCardView.tsx`, `apps/web/components/SwipeDeck.tsx`, `apps/web/components/ExhaustedPanel.tsx`, `apps/web/components/MatchScreen.tsx`

**Interfaces:**
- Consumes: `useRoom` (Task 10); `api`, `loadSession`, `saveSession`, `clearSession`; `JoinRoomForm` (Task 11); `MemberView`, `MovieCard`, `Providers`, `ProviderView`, `RoomState`, `SwipeProgress` from `@mnm/shared`.
- Produces: `fetchMovie(id): Promise<MovieCard>`, `useMovie(id): { movie: MovieCard | null; failed: boolean }`; route `/room/[code]`. User-visible strings used by E2E: list "Members", button "Start swiping", buttons "Like" / "Pass", heading "It's a match!", counter "N / M".

- [ ] **Step 1: Movie fetching with a shared cache**

`apps/web/lib/useMovie.ts`:

```ts
'use client';

import type { MovieCard } from '@mnm/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

const cache = new Map<number, Promise<MovieCard>>();

export function fetchMovie(id: number): Promise<MovieCard> {
  const cached = cache.get(id);
  if (cached) return cached;
  const pending = api.movie(id);
  cache.set(id, pending);
  pending.catch(() => cache.delete(id)); // let a later render retry
  return pending;
}

type Result = { id: number; movie: MovieCard | null; failed: boolean };

export function useMovie(id: number): { movie: MovieCard | null; failed: boolean } {
  const [result, setResult] = useState<Result>({ id, movie: null, failed: false });

  useEffect(() => {
    let isLive = true;
    fetchMovie(id).then(
      (movie) => isLive && setResult({ id, movie, failed: false }),
      () => isLive && setResult({ id, movie: null, failed: true }),
    );
    return () => {
      isLive = false;
    };
  }, [id]);

  return result.id === id ? result : { movie: null, failed: false };
}
```

- [ ] **Step 2: Route and session gate**

`apps/web/app/room/[code]/page.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const RoomClient = dynamic(() => import('@/components/RoomClient'), { ssr: false });

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  return <RoomClient code={code.toUpperCase()} />;
}
```

`apps/web/components/RoomClient.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { loadSession, saveSession } from '@/lib/session';
import { JoinRoomForm } from './JoinRoomForm';
import { RoomScreen } from './RoomScreen';

export default function RoomClient({ code }: { code: string }) {
  const [token, setToken] = useState<string | null>(() => loadSession(code));

  if (!token) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <JoinRoomForm
          initialCode={code}
          onJoined={(joinedCode, joinedToken) => {
            saveSession(joinedCode, joinedToken);
            setToken(joinedToken);
          }}
        />
      </main>
    );
  }
  return <RoomScreen code={code} token={token} />;
}
```

`apps/web/components/Notice.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
```

- [ ] **Step 3: Room screen shell**

`apps/web/components/RoomScreen.tsx`:

```tsx
'use client';

import type { RoomState, SwipeProgress } from '@mnm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { clearSession } from '@/lib/session';
import { useRoom } from '@/lib/useRoom';
import { ExhaustedPanel } from './ExhaustedPanel';
import { Lobby } from './Lobby';
import { MatchScreen } from './MatchScreen';
import { Notice } from './Notice';
import { SwipeDeck } from './SwipeDeck';

type Actions = ReturnType<typeof useRoom>['actions'];

export function RoomScreen({ code, token }: { code: string; token: string }) {
  const router = useRouter();
  const { view, actions } = useRoom(token);

  useEffect(() => {
    if (view.connection === 'ended') clearSession(code);
  }, [view.connection, code]);

  if (view.connection === 'ended') {
    return (
      <Notice title="This room has ended">
        <Link href="/" className="text-amber-400 underline">
          Start a new room
        </Link>
      </Notice>
    );
  }
  if (!view.state) return <Notice title="Connecting…" />;

  async function leave() {
    await actions.leave();
    clearSession(code);
    router.push('/');
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="font-mono text-sm tracking-widest text-zinc-400">{code}</span>
        <button type="button" onClick={leave} className="text-sm text-zinc-400 hover:text-zinc-100">
          Leave room
        </button>
      </header>
      {view.connection === 'connecting' && (
        <p role="status" className="mb-4 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
          Reconnecting…
        </p>
      )}
      {view.error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">
          {view.error}
        </p>
      )}
      <RoomBody state={view.state} progress={view.progress} actions={actions} />
    </main>
  );
}

function RoomBody({ state, progress, actions }: { state: RoomState; progress: Record<number, SwipeProgress>; actions: Actions }) {
  const isHost = state.members.some((m) => m.id === state.me && m.isHost);

  if (state.status === 'LOBBY') return <Lobby code={state.code} members={state.members} isHost={isHost} onStart={actions.start} />;
  if (state.status === 'MATCHED' && state.matchedMovieId !== null) return <MatchScreen movieId={state.matchedMovieId} />;
  if (state.exhausted) return <ExhaustedPanel isHost={isHost} onRestart={actions.restart} />;
  return <SwipeDeck deck={state.deck} position={state.position} progress={progress} onSwipe={actions.swipe} />;
}
```

- [ ] **Step 4: Lobby and exhausted panel**

`apps/web/components/Lobby.tsx`:

```tsx
'use client';

import type { MemberView } from '@mnm/shared';
import { useState } from 'react';

type Props = { code: string; members: MemberView[]; isHost: boolean; onStart: () => Promise<void> };

export function Lobby({ code, members, isHost, onStart }: Props) {
  const [isStarting, setIsStarting] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy invite link');

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyLabel('Link copied');
    } catch {
      setCopyLabel(window.location.href); // clipboard blocked: show the link so it can be copied by hand
    }
  }

  async function start() {
    setIsStarting(true);
    await onStart();
    setIsStarting(false);
  }

  return (
    <section className="space-y-8 text-center">
      <div>
        <p className="text-sm text-zinc-400">Room code</p>
        <p className="mt-1 font-mono text-5xl font-semibold tracking-[0.3em]">{code}</p>
        <button type="button" onClick={copyInvite} className="mt-3 break-all text-sm text-amber-400 hover:underline">
          {copyLabel}
        </button>
      </div>
      <ul aria-label="Members" className="mx-auto max-w-xs space-y-2 text-left">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2">
            <span aria-hidden className={`size-2 rounded-full ${m.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span>{m.nickname}</span>
            {m.isHost && <span className="ml-auto text-xs text-zinc-500">host</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button
          type="button"
          onClick={start}
          disabled={isStarting}
          className="rounded-lg bg-amber-400 px-6 py-2.5 font-medium text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {isStarting ? 'Loading movies…' : 'Start swiping'}
        </button>
      ) : (
        <p className="text-zinc-400">Waiting for the host to start…</p>
      )}
    </section>
  );
}
```

`apps/web/components/ExhaustedPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';

export function ExhaustedPanel({ isHost, onRestart }: { isHost: boolean; onRestart: () => Promise<void> }) {
  const [isLoading, setIsLoading] = useState(false);

  async function restart() {
    setIsLoading(true);
    await onRestart();
    setIsLoading(false);
  }

  return (
    <section className="space-y-4 py-16 text-center">
      <h2 className="text-2xl font-semibold">No match this round</h2>
      {isHost ? (
        <button
          type="button"
          onClick={restart}
          disabled={isLoading}
          className="rounded-lg bg-amber-400 px-6 py-2.5 font-medium text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {isLoading ? 'Loading…' : 'Load 20 more'}
        </button>
      ) : (
        <p className="text-zinc-400">Waiting for the host to load more movies…</p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Movie card and swipe deck**

`apps/web/components/MovieCardView.tsx`:

```tsx
'use client';

import { useMovie } from '@/lib/useMovie';

export function MovieCardView({ movieId }: { movieId: number }) {
  const { movie, failed } = useMovie(movieId);

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 select-none">
      <div className="aspect-[2/3] w-full bg-zinc-800">
        {movie?.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN images, no optimizer needed
          <img src={movie.posterUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-1 p-4">
        <h2 className="text-lg font-semibold">
          {movie ? movie.title : failed ? "Couldn't load this movie" : 'Loading…'}
          {movie?.year && <span className="ml-2 font-normal text-zinc-500">{movie.year}</span>}
        </h2>
        {movie?.overview && <p className="line-clamp-3 text-sm text-zinc-400">{movie.overview}</p>}
      </div>
    </article>
  );
}
```

`apps/web/components/SwipeDeck.tsx`:

```tsx
'use client';

import type { SwipeProgress } from '@mnm/shared';
import { motion, type PanInfo, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { fetchMovie } from '@/lib/useMovie';
import { MovieCardView } from './MovieCardView';

const SWIPE_THRESHOLD_PX = 120;

type Props = {
  deck: number[];
  position: number;
  progress: Record<number, SwipeProgress>;
  onSwipe: (movieId: number, liked: boolean) => Promise<void>;
};

export function SwipeDeck({ deck, position, progress, onSwipe }: Props) {
  const movieId = deck[position];
  const nextId = deck[position + 1];

  useEffect(() => {
    if (nextId !== undefined) fetchMovie(nextId).catch(() => {}); // prefetch only; the card retries on render
  }, [nextId]);

  useEffect(() => {
    if (movieId === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') void onSwipe(movieId, true);
      if (event.key === 'ArrowLeft') void onSwipe(movieId, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [movieId, onSwipe]);

  if (movieId === undefined) {
    return <p className="py-16 text-center text-zinc-400">You're done. Waiting for the others to finish…</p>;
  }

  const current = progress[movieId];
  return (
    <section className="space-y-4">
      <p className="text-center text-sm text-zinc-500">
        {position + 1} / {deck.length}
      </p>
      <SwipeCard key={movieId} movieId={movieId} onSwipe={(liked) => onSwipe(movieId, liked)} />
      <p className="h-5 text-center text-sm text-zinc-400" aria-live="polite">
        {current && current.likes > 0 ? `${current.likes} of ${current.needed} liked this` : ''}
      </p>
      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() => onSwipe(movieId, false)}
          className="w-32 rounded-full border border-zinc-700 py-3 font-medium hover:border-zinc-500"
        >
          Pass
        </button>
        <button
          type="button"
          onClick={() => onSwipe(movieId, true)}
          className="w-32 rounded-full bg-amber-400 py-3 font-medium text-zinc-950 hover:bg-amber-300"
        >
          Like
        </button>
      </div>
    </section>
  );
}

function SwipeCard({ movieId, onSwipe }: { movieId: number; onSwipe: (liked: boolean) => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD_PX) onSwipe(true);
    else if (info.offset.x < -SWIPE_THRESHOLD_PX) onSwipe(false);
  }

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      style={{ x, rotate }}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-sm cursor-grab touch-pan-y active:cursor-grabbing"
    >
      <MovieCardView movieId={movieId} />
    </motion.div>
  );
}
```

- [ ] **Step 6: Match screen**

`apps/web/components/MatchScreen.tsx`:

```tsx
'use client';

import type { ProviderView, Providers } from '@mnm/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MovieCardView } from './MovieCardView';

export function MatchScreen({ movieId }: { movieId: number }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isLive = true;
    api.providers(movieId, 'IN').then(
      (data) => isLive && setProviders(data),
      () => isLive && setHasFailed(true),
    );
    return () => {
      isLive = false;
    };
  }, [movieId]);

  const isEmpty = providers && !providers.flatrate.length && !providers.rent.length && !providers.buy.length;

  return (
    <section className="space-y-6 text-center">
      <h2 className="text-3xl font-semibold text-amber-400">It's a match!</h2>
      <div className="mx-auto max-w-sm">
        <MovieCardView movieId={movieId} />
      </div>
      {hasFailed && <p className="text-sm text-zinc-400">Couldn't load where it's streaming.</p>}
      {isEmpty && <p className="text-sm text-zinc-400">Not streaming in India right now.</p>}
      {providers && (
        <div className="space-y-4">
          <ProviderList title="Stream on" items={providers.flatrate} />
          <ProviderList title="Rent" items={providers.rent} />
          <ProviderList title="Buy" items={providers.buy} />
          {providers.link && (
            <a href={providers.link} target="_blank" rel="noreferrer" className="inline-block text-sm text-amber-400 hover:underline">
              All watch options
            </a>
          )}
          <p className="text-xs text-zinc-500">Streaming data by JustWatch</p>
        </div>
      )}
    </section>
  );
}

function ProviderList({ title, items }: { title: string; items: ProviderView[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm text-zinc-400">{title}</h3>
      <ul className="flex flex-wrap justify-center gap-3">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm">
            {p.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- tiny TMDB logo
              <img src={p.logoUrl} alt="" className="size-6 rounded" />
            )}
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Play a full round by hand**

With `dev:api` and `dev:web` running: create a room in one browser window, open the invite link in a private window and join as a second nickname. Check that:
- both lobbies list both members;
- the host starts and both see card 1 of the same deck;
- liking the same movie in both windows shows "It's a match!" with providers in both;
- refreshing the guest mid-deck resumes at the same card;
- closing the guest window turns their dot grey in the host lobby after ~15s.

Then run `npm run typecheck -w @mnm/web && npm run lint -w @mnm/web` — both exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: add lobby, swipe deck and match screens"
```

---

### Task 13: End-to-end tests

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fake-tmdb.mjs`, `apps/web/e2e/match.spec.ts`

**Interfaces:**
- Consumes: API `start` script, `TMDB_BASE_URL` env, web UI strings from Tasks 11–12.
- Produces: `npm run e2e -w @mnm/web` running two critical journeys against a fake TMDB on :4100, the API on :4001 and Next on :3100.

- [ ] **Step 1: Fake TMDB server**

`apps/web/e2e/fake-tmdb.mjs`:

```js
import { createServer } from 'node:http';

const PORT = 4100;
const DECK = [101, 102, 103];

const movie = (id) => ({
  id,
  title: `Test Movie ${id}`,
  release_date: '2024-05-01',
  poster_path: null,
  overview: `Overview for ${id}`,
});

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (pathname === '/health') return send(200, { ok: true });
  if (pathname === '/discover/movie') return send(200, { results: DECK.map((id) => ({ id })) });

  const providers = pathname.match(/^\/movie\/(\d+)\/watch\/providers$/);
  if (providers) {
    return send(200, {
      id: Number(providers[1]),
      results: {
        IN: { link: 'https://www.themoviedb.org', flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: null }] },
      },
    });
  }

  const details = pathname.match(/^\/movie\/(\d+)$/);
  if (details) return send(200, movie(Number(details[1])));

  return send(404, { status_message: 'not found' });
}).listen(PORT, () => console.log(`fake TMDB listening on :${PORT}`));
```

- [ ] **Step 2: Playwright config**

`apps/web/playwright.config.ts`:

```ts
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
```

- [ ] **Step 3: Write the journeys**

`apps/web/e2e/match.spec.ts`:

```ts
import { type Browser, expect, type Page, test } from '@playwright/test';

async function hostRoom(browser: Browser, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Start a room' });
  await form.getByLabel('Your nickname').fill(nickname);
  await form.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/);
  return page;
}

async function joinByLink(browser: Browser, url: string, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await page.getByLabel('Your nickname').fill(nickname);
  await page.getByRole('button', { name: 'Join room' }).click();
  return page;
}

test('two friends swipe to a match and see where it streams', async ({ browser }) => {
  const host = await hostRoom(browser, 'Ana');
  const guest = await joinByLink(browser, host.url(), 'Ben');

  await expect(host.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await host.getByRole('button', { name: 'Start swiping' }).click();

  for (const page of [host, guest]) {
    await expect(page.getByText('Test Movie 101')).toBeVisible();
    await page.getByRole('button', { name: 'Like' }).click();
  }

  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: "It's a match!" })).toBeVisible();
    await expect(page.getByText('Netflix')).toBeVisible();
  }
});

test('a refresh mid-deck resumes at the same card', async ({ browser }) => {
  const host = await hostRoom(browser, 'Ana');
  const guest = await joinByLink(browser, host.url(), 'Ben');
  await expect(host.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await host.getByRole('button', { name: 'Start swiping' }).click();

  await expect(guest.getByText('Test Movie 101')).toBeVisible();
  await guest.getByRole('button', { name: 'Pass' }).click();
  await expect(guest.getByText('Test Movie 102')).toBeVisible();

  await guest.reload();
  await expect(guest.getByText('Test Movie 102')).toBeVisible();
  await expect(guest.getByText('2 / 3')).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E suite**

Stop any running `dev:web` (Next 16 allows one dev server per project directory). Make sure the test DB is migrated (`npm test -w @mnm/api` does this), then:

```bash
npx -w @mnm/web playwright install chromium
npm run e2e -w @mnm/web
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json package-lock.json
git commit -m "test: add e2e journeys for match and refresh resume"
```

---

### Task 14: CI and README

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: all workspace scripts.
- Produces: a green GitHub Actions run on push and pull request; a README a reviewer can follow from clone to running app.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: mnm
          POSTGRES_PASSWORD: mnm
          POSTGRES_DB: mnm_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U mnm"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 15
    env:
      TEST_DATABASE_URL: postgresql://mnm:mnm@localhost:5433/mnm_test
      E2E_DATABASE_URL: postgresql://mnm:mnm@localhost:5433/mnm_test
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:coverage -w @mnm/api
      - run: npm test -w @mnm/shared
      - run: npm test -w @mnm/web
      - run: npx -w @mnm/web playwright install --with-deps chromium
      - run: npm run e2e -w @mnm/web
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report
```

- [ ] **Step 2: README**

`README.md` — write these sections with real content:

1. **Title + one-line pitch** + live links (filled in by Task 15).
2. **How it works** — 3 bullets: rooms with a share code, one shared deck from the host's filters, unanimous first hit wins.
3. **Architecture** — this Mermaid diagram:

````markdown
```mermaid
flowchart LR
  subgraph Browser
    W[Next.js app]
  end
  subgraph Render
    F[Fastify REST] --- S[Socket.IO gateway]
    F --> RS[Room service]
    S --> RS
    S --> SW[Swipe service]
  end
  W -- REST: create/join, movies --> F
  W <-- WebSocket: room:state, swipe, matched --> S
  RS --> PG[(Postgres / Neon)]
  SW --> PG
  F --> T[TMDB API]
  RS --> T
```
````

4. **Race-safe matching** (the interview talking point, ~150 words): two final likes arriving together under READ COMMITTED each count before seeing the other's insert, so neither sees a full house and the match is lost. Every swipe transaction starts with `SELECT … FROM "Room" WHERE id = $1 FOR UPDATE`, serializing writes per room; the `matchedMovieId IS NULL` conditional update guards the transition so a room matches at most once. Include what Task 5 Step 7 showed when the lock was removed, and link `apps/api/tests/swipes.test.ts`.
5. **Reconnects and presence** — snapshot on every connect, 15s grace, multi-tab handling, host handoff, `room:sync` resync.
6. **Local setup** — Docker → `npm run db:up`; `cp apps/api/.env.example apps/api/.env` (TMDB key, `openssl rand -hex 32`); `cp apps/web/.env.example apps/web/.env.local`; `npm install`; `cd apps/api && npx prisma migrate dev && cd ../..`; `npm run dev:api` + `npm run dev:web`.
7. **Tests** — `npm test`, `npm run test:coverage -w @mnm/api`, `npm run e2e -w @mnm/web`.
8. **Tech stack** list and the TMDB attribution sentence.

- [ ] **Step 3: Verify locally**

Run: `npm run typecheck && npm run lint && npm test && npm run test:coverage -w @mnm/api`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github README.md
git commit -m "docs: add readme with architecture and ci workflow"
```

---

### Task 15: Deploy (needs the user — outward-facing)

**Files:**
- Modify: `README.md` (live links)

Every step here publishes something or creates an external resource. **Confirm each one with the user before running it.**

- [ ] **Step 1: GitHub remote** — ask whether `Kruthik481/movie-night-matcher` should be public (portfolio) or private. Then `gh repo create Kruthik481/movie-night-matcher --<visibility> --source . --push`. Confirm the CI run goes green: `gh run watch`.
- [ ] **Step 2: Neon Postgres** — the user creates a project in region `ap-southeast-1` (closest to India) and provides the pooled connection string. Run `DATABASE_URL='<neon url>' npx prisma migrate deploy` from `apps/api`.
- [ ] **Step 3: Render web service** — repo root, runtime Node, build command `npm ci && npm run db:deploy -w @mnm/api`, start command `npm run start -w @mnm/api`, health check path `/health`, env vars `DATABASE_URL`, `TMDB_API_KEY`, `JWT_SECRET` (fresh `openssl rand -hex 32`), `WEB_ORIGIN` (set after Step 4), `NODE_VERSION=24`. Free tier sleeps after idle; the first request takes ~50s.
- [ ] **Step 4: Vercel** — import the repo with root directory `apps/web`, env `NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com`. Then set Render's `WEB_ORIGIN` to the Vercel production URL and redeploy the API.
- [ ] **Step 5: Live smoke test** — repeat the Task 12 Step 7 checklist on the production URLs with two devices (one phone).
- [ ] **Step 6: Commit the live links**

```bash
git add README.md
git commit -m "docs: add live demo links"
git push
```
