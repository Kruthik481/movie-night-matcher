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
