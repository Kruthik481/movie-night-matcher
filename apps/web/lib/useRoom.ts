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
