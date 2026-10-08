'use client';

import type { SwipeProgress } from '@mnm/shared';
import { Heart, X } from 'lucide-react';
import { AnimatePresence, motion, type PanInfo, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { fetchMovie } from '@/lib/useMovie';
import { cn } from '@/lib/utils';
import { Burst } from './cinema/Burst';
import { SPRING } from './cinema/motion';
import { PosterGlow } from './cinema/PosterGlow';
import { ReelLoader } from './cinema/ReelLoader';
import { MovieCardView } from './MovieCardView';

const SWIPE_THRESHOLD_PX = 110;
const SWIPE_VELOCITY = 600;
const EXIT_X = 640;
const PEEKS = 2;

type Props = {
  deck: number[];
  position: number;
  progress: Record<number, SwipeProgress>;
  onSwipe: (movieId: number, liked: boolean) => Promise<void>;
};

export function SwipeDeck({ deck, position, progress, onSwipe }: Props) {
  const movieId = deck[position];
  const [exitDir, setExitDir] = useState(1);
  const [likeBursts, setLikeBursts] = useState(0);

  useEffect(() => {
    for (const id of deck.slice(position + 1, position + 1 + PEEKS)) {
      fetchMovie(id).catch(() => {}); // prefetch only; the card retries on render
    }
  }, [deck, position]);

  const swipe = useCallback(
    (liked: boolean) => {
      if (movieId === undefined) return;
      setExitDir(liked ? 1 : -1);
      if (liked) setLikeBursts((n) => n + 1);
      void onSwipe(movieId, liked);
    },
    [movieId, onSwipe],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return; // holding a key must not fire through the deck
      if (event.key === 'ArrowRight') swipe(true);
      if (event.key === 'ArrowLeft') swipe(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swipe]);

  if (movieId === undefined) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <ReelLoader />
        <p className="font-display text-3xl font-bold text-tungsten">{"You're done"}</p>
        <p className="text-cream/70">Waiting for the others to finish…</p>
      </div>
    );
  }

  const current = progress[movieId];
  const peeks = deck.slice(position + 1, position + 1 + PEEKS);

  return (
    <section className="flex flex-col items-center gap-5">
      <PosterGlow movieId={movieId} />
      <FilmStrip total={deck.length} position={position} />

      <div className="relative aspect-[2/3] w-full max-w-[340px]">
        {peeks.map((id, i) => (
          <motion.div
            key={id}
            className="absolute inset-0"
            style={{ zIndex: PEEKS - i }}
            initial={false}
            animate={{ scale: 1 - (i + 1) * 0.06, y: (i + 1) * 26, opacity: 1 - (i + 1) * 0.22 }}
            transition={SPRING}
          >
            <MovieCardView movieId={id} variant="peek" />
          </motion.div>
        ))}
        <AnimatePresence custom={exitDir} initial={false}>
          <SwipeCard key={movieId} movieId={movieId} onSwipe={swipe} />
        </AnimatePresence>
      </div>

      <p className="h-6 text-sm text-cream/80" aria-live="polite">
        {current && current.likes > 0 && (
          <motion.span key={`${movieId}-${current.likes}`} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex items-center gap-1.5">
            <Heart aria-hidden className="size-4 fill-marquee text-marquee" />
            {current.likes} of {current.needed} liked this
          </motion.span>
        )}
      </p>

      <div className="flex items-center gap-8">
        <motion.button
          type="button"
          aria-label="Pass"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => swipe(false)}
          className="grid size-16 place-items-center rounded-full border-2 border-exit/70 bg-black/40 text-exit backdrop-blur hover:bg-exit/15"
        >
          <X aria-hidden className="size-8" strokeWidth={2.6} />
        </motion.button>
        <div className="relative">
          <Burst trigger={likeBursts} />
          <motion.button
            type="button"
            aria-label="Like"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => swipe(true)}
            className="grid size-20 place-items-center rounded-full bg-marquee text-velvet shadow-[0_0_0_4px_rgb(246_183_60/0.25),0_14px_40px_-8px_rgb(246_183_60/0.8)]"
          >
            <Heart aria-hidden className="size-9 fill-velvet" />
          </motion.button>
        </div>
      </div>
      <p className="hidden text-xs text-cream/45 sm:block">Drag the poster, or use the ← and → keys</p>
    </section>
  );
}

function FilmStrip({ total, position }: { total: number; position: number }) {
  return (
    <div className="flex w-full max-w-[340px] items-center gap-3">
      <div aria-hidden className="flex flex-1 gap-[3px] rounded-md bg-black/55 px-1.5 py-1 ring-1 ring-tungsten/10">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-2.5 flex-1 rounded-[2px] transition-all duration-300',
              i < position && 'bg-marquee/55',
              i === position && 'bg-tungsten shadow-[0_0_10px_2px_rgb(246_183_60/0.7)]',
              i > position && 'bg-cream/10',
            )}
          />
        ))}
      </div>
      <span className="font-display text-xl font-bold text-cream/85 tabular-nums">
        {position + 1} / {total}
      </span>
    </div>
  );
}

const cardVariants = {
  enter: { scale: 0.95, y: 16, opacity: 0.7 },
  center: { scale: 1, y: 0, opacity: 1, transition: SPRING },
  exit: (dir: number) => ({ x: dir * EXIT_X, rotate: dir * 26, opacity: 0, transition: { duration: 0.35, ease: 'easeIn' as const } }),
};

function SwipeCard({ movieId, onSwipe }: { movieId: number; onSwipe: (liked: boolean) => void }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-16, 16]);
  const likeOpacity = useTransform(x, [20, SWIPE_THRESHOLD_PX], [0, 1]);
  const passOpacity = useTransform(x, [-SWIPE_THRESHOLD_PX, -20], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD_PX || info.velocity.x > SWIPE_VELOCITY) onSwipe(true);
    else if (info.offset.x < -SWIPE_THRESHOLD_PX || info.velocity.x < -SWIPE_VELOCITY) onSwipe(false);
  }

  return (
    <motion.div
      className="absolute inset-0 z-10 cursor-grab touch-pan-y active:cursor-grabbing"
      style={{ x, rotate: reduce ? 0 : rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={onDragEnd}
      variants={cardVariants}
      initial={reduce ? false : 'enter'}
      animate="center"
      exit={reduce ? { opacity: 0 } : 'exit'}
    >
      <MovieCardView movieId={movieId} />
      <motion.span
        aria-hidden
        style={{ opacity: likeOpacity }}
        className="absolute top-6 left-5 -rotate-12 rounded-lg border-4 border-marquee bg-velvet/85 px-3 py-1 font-display text-4xl font-extrabold text-marquee shadow-[0_0_24px_rgb(246_183_60/0.5)]"
      >
        Like
      </motion.span>
      <motion.span
        aria-hidden
        style={{ opacity: passOpacity }}
        className="absolute top-6 right-5 rotate-12 rounded-lg border-4 border-exit bg-velvet/85 px-3 py-1 font-display text-4xl font-extrabold text-exit shadow-[0_0_24px_rgb(229_72_77/0.45)]"
      >
        Pass
      </motion.span>
    </motion.div>
  );
}
