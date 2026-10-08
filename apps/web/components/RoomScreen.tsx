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
