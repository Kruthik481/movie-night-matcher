'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useMovie } from '@/lib/useMovie';

/** The current poster, blurred huge behind everything, so the whole room takes on the movie's color. */
export function PosterGlow({ movieId }: { movieId: number }) {
  const { movie } = useMovie(movieId);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <AnimatePresence>
        {movie?.posterUrl && (
          <motion.img
            key={movie.posterUrl}
            src={movie.posterUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-velvet/30 via-velvet/70 to-velvet" />
    </div>
  );
}
