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
