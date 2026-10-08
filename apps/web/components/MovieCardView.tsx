'use client';

import { useMovie } from '@/lib/useMovie';

export function MovieCardView({ movieId }: { movieId: number }) {
  const { movie, failed } = useMovie(movieId);

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 select-none">
      <div className="aspect-[2/3] w-full bg-zinc-800">
        {movie?.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN images, no optimizer needed
          <img src={movie.posterUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-1 p-4">
        <h2 className="text-lg font-semibold">
          {movie ? movie.title : failed ? "Couldn't load this movie" : 'Loading…'}
          {movie?.year && <span className="ml-2 font-normal text-zinc-500">{movie.year}</span>}
        </h2>
        {movie?.overview && <p className="line-clamp-3 text-sm text-zinc-400">{movie.overview}</p>}
      </div>
    </article>
  );
}
