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
