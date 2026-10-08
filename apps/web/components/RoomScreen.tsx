"use client";

import type { RoomState, SwipeProgress } from "@mnm/shared";
import { LogOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearSession } from "@/lib/session";
import { useRoom } from "@/lib/useRoom";
import { MemberOrb } from "./cinema/MemberOrb";
import { ExhaustedPanel } from "./ExhaustedPanel";
import { Lobby } from "./Lobby";
import { MatchScreen } from "./MatchScreen";
import { Notice } from "./Notice";
import { SwipeDeck } from "./SwipeDeck";

type Actions = ReturnType<typeof useRoom>["actions"];

const HEADER_ORBS = 5;

export function RoomScreen({ code, token }: { code: string; token: string }) {
  const router = useRouter();
  const { view, actions } = useRoom(token);

  useEffect(() => {
    if (view.connection === "ended") clearSession(code);
  }, [view.connection, code]);

  if (view.connection === "ended") {
    return (
      <Notice title="The credits rolled">
        <p className="text-cream/70">
          This room has ended. Rooms close after a match or after 24 hours.
        </p>
        <Link
          href="/"
          className="font-display text-xl font-bold text-marquee underline-offset-4 hover:underline"
        >
          Start a new room
        </Link>
      </Notice>
    );
  }
  if (!view.state) return <Notice title="Connecting…" isLoading />;

  async function leave() {
    await actions.leave();
    clearSession(code);
    router.push("/");
  }

  const state = view.state;
  return (
    // full-width clip so confetti and a card dragged off-screen never create sideways scroll
    <div className="overflow-x-clip">
      <main className="relative mx-auto max-w-lg px-4 py-5">
        <header className="mb-6 flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/40 px-3 py-1 font-display text-lg font-bold tracking-[0.25em] text-tungsten ring-1 ring-tungsten/15">
            {code}
          </span>
          {state.status !== "LOBBY" && (
            <div aria-hidden className="flex -space-x-2">
              {state.members.slice(0, HEADER_ORBS).map((m) => (
                <MemberOrb key={m.id} member={m} size="sm" />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={leave}
            className="inline-flex items-center gap-1.5 text-sm text-cream/60 hover:text-cream"
          >
            <LogOut aria-hidden className="size-4" />
            Leave room
          </button>
        </header>
        <AnimatePresence>
          {view.connection === "connecting" && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 rounded-xl bg-black/50 px-4 py-2 text-sm text-cream/80 ring-1 ring-tungsten/10"
            >
              Reconnecting…
            </motion.p>
          )}
          {view.error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 rounded-xl bg-exit/15 px-4 py-2 text-sm text-[#ffb3b5] ring-1 ring-exit/40"
            >
              {view.error}
            </motion.p>
          )}
        </AnimatePresence>
        <RoomBody state={state} progress={view.progress} actions={actions} />
      </main>
    </div>
  );
}

function RoomBody({
  state,
  progress,
  actions,
}: {
  state: RoomState;
  progress: Record<number, SwipeProgress>;
  actions: Actions;
}) {
  const isHost = state.members.some((m) => m.id === state.me && m.isHost);

  if (state.status === "LOBBY") {
    return (
      <Lobby
        code={state.code}
        members={state.members}
        filters={state.filters}
        isHost={isHost}
        onStart={actions.start}
      />
    );
  }
  if (state.status === "MATCHED" && state.matchedMovieId !== null) {
    return (
      <MatchScreen
        movieId={state.matchedMovieId}
        code={state.code}
        progress={progress}
      />
    );
  }
  if (state.exhausted)
    return <ExhaustedPanel isHost={isHost} onRestart={actions.restart} />;
  return (
    <SwipeDeck
      deck={state.deck}
      position={state.position}
      progress={progress}
      onSwipe={actions.swipe}
    />
  );
}
