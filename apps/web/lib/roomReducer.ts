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
