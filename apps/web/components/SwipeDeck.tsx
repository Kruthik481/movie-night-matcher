'use client';

import type { SwipeProgress } from '@mnm/shared';
import { motion, type PanInfo, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { fetchMovie } from '@/lib/useMovie';
import { MovieCardView } from './MovieCardView';

const SWIPE_THRESHOLD_PX = 120;

type Props = {
  deck: number[];
  position: number;
  progress: Record<number, SwipeProgress>;
  onSwipe: (movieId: number, liked: boolean) => Promise<void>;
};

export function SwipeDeck({ deck, position, progress, onSwipe }: Props) {
  const movieId = deck[position];
  const nextId = deck[position + 1];

  useEffect(() => {
    if (nextId !== undefined) fetchMovie(nextId).catch(() => {}); // prefetch only; the card retries on render
  }, [nextId]);

  useEffect(() => {
    if (movieId === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') void onSwipe(movieId, true);
      if (event.key === 'ArrowLeft') void onSwipe(movieId, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [movieId, onSwipe]);

  if (movieId === undefined) {
    return <p className="py-16 text-center text-zinc-400">{"You're done. Waiting for the others to finish…"}</p>;
  }

  const current = progress[movieId];
  return (
    <section className="space-y-4">
      <p className="text-center text-sm text-zinc-500">
        {position + 1} / {deck.length}
      </p>
      <SwipeCard key={movieId} movieId={movieId} onSwipe={(liked) => onSwipe(movieId, liked)} />
      <p className="h-5 text-center text-sm text-zinc-400" aria-live="polite">
        {current && current.likes > 0 ? `${current.likes} of ${current.needed} liked this` : ''}
      </p>
      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() => onSwipe(movieId, false)}
          className="w-32 rounded-full border border-zinc-700 py-3 font-medium hover:border-zinc-500"
        >
          Pass
        </button>
        <button
          type="button"
          onClick={() => onSwipe(movieId, true)}
          className="w-32 rounded-full bg-amber-400 py-3 font-medium text-zinc-950 hover:bg-amber-300"
        >
          Like
        </button>
      </div>
    </section>
  );
}

function SwipeCard({ movieId, onSwipe }: { movieId: number; onSwipe: (liked: boolean) => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD_PX) onSwipe(true);
    else if (info.offset.x < -SWIPE_THRESHOLD_PX) onSwipe(false);
  }

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      style={{ x, rotate }}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-sm cursor-grab touch-pan-y active:cursor-grabbing"
    >
      <MovieCardView movieId={movieId} />
    </motion.div>
  );
}
