import type { RoomState } from '@mnm/shared';
import { describe, expect, it } from 'vitest';
import { initialRoomView, RESYNC_CODES, roomReducer, type RoomView, shouldReconnect, shouldResync } from './roomReducer';

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

describe('shouldResync', () => {
  it('always resyncs after a failed swipe, since the client already advanced', () => {
    expect(shouldResync('swipe', 'RATE_LIMITED')).toBe(true);
    expect(shouldResync('swipe', 'INTERNAL')).toBe(true);
    expect(shouldResync('swipe', null)).toBe(true);
  });

  it('resyncs other actions only for stale-view codes', () => {
    expect(shouldResync('other', 'NOT_IN_DECK')).toBe(true);
    expect(shouldResync('other', 'NOT_HOST')).toBe(false);
    expect(shouldResync('other', null)).toBe(false);
  });
});

describe('RESYNC_CODES', () => {
  it('covers every server code that means the client view is stale', () => {
    for (const code of ['NOT_IN_DECK', 'OUT_OF_ORDER', 'ROOM_NOT_SWIPING', 'MEMBER_INACTIVE']) {
      expect(RESYNC_CODES.has(code)).toBe(true);
    }
  });
});

describe('shouldReconnect', () => {
  it('reconnects after the server drops the socket, which socket.io never retries itself', () => {
    expect(shouldReconnect('io server disconnect', false)).toBe(true);
  });

  it('stays closed after the member chose to leave', () => {
    expect(shouldReconnect('io server disconnect', true)).toBe(false);
  });

  it('leaves transport drops to socket.io, which already retries them', () => {
    expect(shouldReconnect('transport close', false)).toBe(false);
    expect(shouldReconnect('io client disconnect', false)).toBe(false);
  });
});
