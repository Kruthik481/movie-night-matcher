# Movie Night Matcher — Design

Date: 2026-10-08
Status: approved in brainstorm, pending written-spec review

## Purpose

A group picks a movie together. A host creates a room, friends join with a code, everyone swipes the same deck live, and the first movie that every active member likes wins. The match screen shows where it streams (TMDB watch providers, region IN by default).

Portfolio goal: a full-stack/backend showcase. The interesting parts are real-time sync, race-safe match detection, reconnect recovery, tests, and a live deploy.

## Decisions

| Topic | Decision |
|---|---|
| Match rule | Unanimous among **active** members; first hit ends the round |
| Deck | Host sets filters (genres, original language, optional provider list); server builds one shared deck from one TMDB discover page (~20 movies); same order for everyone |
| Identity | Guests only. Nickname + signed JWT session token `{ memberId, roomId }`. No accounts |
| Persistence | Postgres is the source of truth; rooms deleted 24h after creation |
| Scale | Single Fastify instance; no Redis |
| Stack | pnpm monorepo: Next.js (App Router), Fastify + Socket.IO, Prisma + Postgres, zod, TypeScript throughout |
| Deploy | Web on Vercel, API on Render, Postgres on Neon |

## Repo layout

```
movie-night-matcher/
  apps/web        Next.js: lobby, swipe deck, match screen
  apps/api        Fastify + Socket.IO + Prisma
    src/tmdb/     TMDB client: discover + watch providers, in-memory TTL cache, retry with backoff
    src/rooms/    create/join, token issue/verify
    src/swipes/   recordSwipe() transaction + match check
    src/realtime/ Socket.IO gateway: auth, validate, call services, broadcast. No business logic
    src/cleanup   interval job deleting rooms older than 24h
  packages/shared zod schemas + inferred types for every REST payload and socket event
```

## Data model (Prisma)

```prisma
enum RoomStatus { LOBBY SWIPING MATCHED }

model Room {
  id             String     @id @default(cuid())
  code           String     @unique          // 6 chars, uppercase, no ambiguous chars
  hostId         String
  filters        Json
  deck           Int[]                       // TMDB ids, fixed order
  page           Int        @default(1)      // TMDB discover page for the current deck
  status         RoomStatus @default(LOBBY)
  matchedMovieId Int?
  createdAt      DateTime   @default(now())
  members        Member[]
  swipes         Swipe[]
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
}
```

Movie metadata is not stored; only TMDB ids.

## Match detection (core invariant)

`recordSwipe(roomId, memberId, movieId, liked)` runs in one transaction:

1. `SELECT ... FROM Room WHERE id = roomId FOR UPDATE`: row lock serializes swipes within a room (READ COMMITTED alone would let two concurrent final swipes each miss the other's insert and both see `likes < needed`, so no match). Reject unless status is `SWIPING` and `movieId` is in `room.deck`.
2. `INSERT ... ON CONFLICT DO NOTHING` on the swipe primary key (duplicate = no-op).
3. `likes` = count of `liked = true` swipes on `movieId` from **active** members; `needed` = count of active members.
4. If `likes == needed`: `UPDATE Room SET status = MATCHED, matchedMovieId = movieId WHERE id = roomId AND matchedMovieId IS NULL`. The `matchedMovieId IS NULL` guard is defense in depth behind the lock; the caller with `rowCount = 1` broadcasts `room:matched`.
5. Return `{ likes, needed, matched: movieId | null }`.

When a member becomes inactive, `recheckMatches(roomId)` runs the same check over all movies in the deck (in deck order) so a departure can complete a match.

Invariant: a room transitions to `MATCHED` at most once, and only for a movie liked by every member active at that moment.

## REST API

| Route | Body / params | Response | Errors |
|---|---|---|---|
| `POST /rooms` | `{ nickname, filters }` | `{ code, token }` | 400 |
| `POST /rooms/:code/join` | `{ nickname }` | `{ token }` | 404 unknown, 409 nickname taken, 410 expired/matched |
| `GET /movies/:id` | — | `{ id, title, year, posterUrl, overview }` | 404, 502 |
| `GET /movies/:id/providers?region=IN` | — | `{ flatrate[], rent[], buy[], link }` | 502 |

Rate limited (`@fastify/rate-limit`) on room create/join.

## Socket.IO events

Handshake: `auth.token` verified; failure rejects the connection. Socket joins `room:<id>`.

| Client → Server | Effect |
|---|---|
| `room:start` (host only) | Build deck from TMDB discover with filters, status `SWIPING`, broadcast `room:state` |
| `room:restart` (host only, after `deck:exhausted`) | Fetch next discover page (optionally new filters), clear swipes, broadcast `room:state` |
| `swipe { movieId, liked }` | `recordSwipe`; ack with progress |
| `room:leave` | Member inactive, `recheckMatches` |

| Server → Room | Payload |
|---|---|
| `room:state` | Full snapshot: status, members (nickname, active), deck, own swipe position, matchedMovieId |
| `member:joined` / `member:left` | `{ memberId, nickname }` |
| `swipe:progress` | `{ movieId, likes, needed }` (counts only, never who) |
| `room:matched` | `{ movieId }` |
| `deck:exhausted` | Every active member has swiped the whole deck with no match |

All payloads validated with the shared zod schemas. Per-socket swipe throttle.

## Reconnect and presence

- On every connect the server sends `room:state` from Postgres; clients never trust local state. Refresh resumes at the right card.
- Disconnect starts a 15s grace timer; on expiry the member becomes inactive and `recheckMatches` runs. Reconnecting within the window cancels it; reconnecting after re-activates the member.

## Error handling

- zod validation at every boundary; REST 400 with message, socket `error` ack, socket stays open.
- Invalid/expired token: connection refused; client clears token and shows "This room has ended".
- TMDB: 3 retries with exponential backoff; `room:start` failure leaves room in `LOBBY` with "Couldn't load movies, try again"; card fetch failure shows placeholder.
- Unexpected errors logged with pino (structured, with roomId/memberId); clients get a generic message.
- Required env (`DATABASE_URL`, `TMDB_API_KEY`, `JWT_SECRET`, `WEB_ORIGIN`) validated with zod at startup; missing values fail fast.

## Testing

- Unit (Vitest): match logic, deck building, code generation, TMDB client with mocked fetch.
- Integration (Vitest + Postgres in Docker): `recordSwipe` race (two final swipes in parallel → exactly one match, never zero), duplicate swipe, member leave completes a match, REST routes.
- Socket: three `socket.io-client` instances drive join → start → swipe → match, and reconnect mid-deck.
- E2E (Playwright): two browser contexts reach a match.
- CI (GitHub Actions): lint, typecheck, tests. Target ≥80% coverage on `apps/api`.

## Out of scope (v1)

Accounts and history, multi-instance with Redis adapter, chat, threshold matching, seed-movie decks, native apps.

## Deliverables

- Live web + API deploys.
- README with architecture diagram and a short write-up of the race-safe match detection.

## Revisions (2026-10-08, during planning)

- npm workspaces instead of pnpm (pnpm not installed; Node 25 dropped corepack).
- Presence changes broadcast a fresh `room:state` to everyone instead of `member:joined` / `member:left`.
- New client event `room:sync`: ack returns the caller's snapshot; used to resync after a rejected stale swipe.
- Server enforces swipe order: a new swipe must be for `deck[mySwipeCount]` (`409 OUT_OF_ORDER`).
- Host handoff: when the host goes inactive, the earliest-joined active member becomes host.
- New env `TMDB_BASE_URL` (default `https://api.themoviedb.org/3`) for the E2E fake TMDB.
- Empty deck → `422 NO_MOVIES`; rooms cap at 10 members → `409 ROOM_FULL`.
- v1 exhausted-deck UI offers "Load 20 more" (same filters, next page); the API already accepts new filters.
