'use client';

import type { SwipeProgress } from '@mnm/shared';
import { useEffect, useMemo, useState } from 'react';
import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import { ChartTooltip } from '@/components/charts/tooltip';
import { fetchMovie } from '@/lib/useMovie';

const MAX_ROWS = 5;
const MIN_ROWS = 2;
const TITLE_MAX = 20;

const shorten = (title: string) => (title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title);

type Props = { progress: Record<number, SwipeProgress>; matchedMovieId: number };

/** "So close": the movies the room almost picked, from the like counts streamed during swiping. */
export function RoomRecap({ progress, matchedMovieId }: Props) {
  const rows = useMemo(
    () =>
      Object.values(progress)
        .filter((p) => p.movieId !== matchedMovieId && p.likes > 0)
        .sort((a, b) => b.likes - a.likes)
        .slice(0, MAX_ROWS),
    [progress, matchedMovieId],
  );
  const [titles, setTitles] = useState<Record<number, string> | null>(null);

  useEffect(() => {
    let isLive = true;
    void Promise.all(
      rows.map((row) =>
        fetchMovie(row.movieId).then(
          (movie) => [row.movieId, movie.title] as const,
          () => [row.movieId, `Movie ${row.movieId}`] as const,
        ),
      ),
    ).then((pairs) => {
      if (isLive) setTitles(Object.fromEntries(pairs));
    });
    return () => {
      isLive = false;
    };
  }, [rows]);

  // wait for every title: the chart keys bars by name, and placeholder names would collide
  if (rows.length < MIN_ROWS || !titles || rows.some((row) => !(row.movieId in titles))) return null;
  const data = rows.map((row) => ({
    id: row.movieId,
    name: shorten(titles[row.movieId] ?? `Movie ${row.movieId}`),
    likes: row.likes,
    short: Math.max(row.needed - row.likes, 0),
  }));
  const needed = rows[0]?.needed ?? 0;

  return (
    <section aria-labelledby="recap-heading" className="w-full max-w-md text-left">
      <h3 id="recap-heading" className="font-display text-3xl font-bold text-tungsten">
        So close
      </h3>
      <p className="mt-1 text-sm text-cream/65">Movies your room almost picked, by likes out of {needed}.</p>
      <div className="mt-4 rounded-2xl bg-black/35 p-3 ring-1 ring-tungsten/10">
        <BarChart
          data={data}
          xDataKey="name"
          orientation="horizontal"
          stacked
          stackGap={2}
          barGap={0.45}
          aspectRatio={`5 / ${Math.max(data.length, 2)}`}
          barWidth={20}
          margin={{ top: 8, right: 16, bottom: 8, left: 120 }}
        >
          <Bar dataKey="likes" fill="var(--marquee)" lineCap={4} />
          <Bar dataKey="short" fill="#5a3340" lineCap={4} />
          <BarYAxis />
          <ChartTooltip />
        </BarChart>
        <div className="mt-2 flex gap-4 px-2 text-xs text-cream/70">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-marquee" />
            Liked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-[#5a3340]" />
            Still needed
          </span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Likes per movie</caption>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              <td>
                {row.likes} of {needed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
