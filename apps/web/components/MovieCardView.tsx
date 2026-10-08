'use client';

import { Clapperboard } from 'lucide-react';
import { useMovie } from '@/lib/useMovie';
import { cn } from '@/lib/utils';

type Props = { movieId: number; variant?: 'full' | 'peek'; className?: string };

/** A movie poster card. `peek` is the decorative version: poster only, hidden from screen readers. */
export function MovieCardView({ movieId, variant = 'full', className }: Props) {
  const { movie, failed } = useMovie(movieId);
  const isPeek = variant === 'peek';

  return (
    <article
      aria-hidden={isPeek || undefined}
      className={cn(
        'relative h-full w-full overflow-hidden rounded-[22px] bg-gradient-to-br from-curtain to-velvet ring-1 ring-tungsten/15 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.95)] select-none',
        className,
      )}
    >
      {movie?.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN images, no optimizer needed
        <img src={movie.posterUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Clapperboard aria-hidden className="size-16 text-marquee/40" />
        </div>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.06] to-transparent" />
      {!isPeek && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent p-5 pt-20">
          <h2 className="font-display text-4xl leading-[0.95] font-extrabold text-tungsten">
            {movie ? movie.title : failed ? "Couldn't load this movie" : 'Loading…'}
          </h2>
          {movie?.year && <p className="mt-1 text-sm font-medium text-marquee">{movie.year}</p>}
          {movie?.overview && <p className="mt-2 line-clamp-2 text-sm text-cream/80">{movie.overview}</p>}
        </div>
      )}
    </article>
  );
}
