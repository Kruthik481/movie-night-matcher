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
