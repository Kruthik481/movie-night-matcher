'use client';

import type { ProviderView, Providers, SwipeProgress } from '@mnm/shared';
import { animate, createTimeline, utils } from 'animejs';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useMovie } from '@/lib/useMovie';
import { prefersReducedMotion } from './cinema/motion';
import { RoomRecap } from './cinema/RoomRecap';
import { ShimmerText } from './cinema/ShimmerText';
import { MovieCardView } from './MovieCardView';

const CONFETTI = 44;
const CONFETTI_COLORS = ['#f6b73c', '#ffe7b8', '#e5484d', '#ede0c8', '#c9853a'];

type Props = { movieId: number; code: string; progress: Record<number, SwipeProgress> };

export function MatchScreen({ movieId, code, progress }: Props) {
  const root = useRef<HTMLElement>(null);
  const { movie } = useMovie(movieId);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const isAnimated = useMemo(() => !prefersReducedMotion(), []);
  const today = useMemo(() => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), []);

  useEffect(() => {
    let isLive = true;
    api.providers(movieId, 'IN').then(
      (data) => isLive && setProviders(data),
      () => isLive && setHasFailed(true),
    );
    return () => {
      isLive = false;
    };
  }, [movieId]);

  useEffect(() => {
    const el = root.current;
    if (!el || !isAnimated) return;
    const part = (name: string) => el.querySelector(`[data-part="${name}"]`) as HTMLElement;
    const intro = createTimeline({ defaults: { ease: 'outExpo' } })
      .add(part('spot'), { opacity: [0, 1], scale: [0.3, 1], duration: 1000 })
      .add(part('heading'), { opacity: [0, 1], scale: [0.55, 1], duration: 800, ease: 'outBack' }, '-=750')
      .add(part('stub'), { opacity: [0, 1], y: [140, 0], rotate: [-7, 0], duration: 1000 }, '-=550')
      .add(part('tear'), { scaleX: [0, 1], duration: 500, ease: 'inOutQuad' }, '-=350')
      .add(part('rest'), { opacity: [0, 1], y: [24, 0], duration: 700 }, '-=200');
    const bursts = Array.from(el.querySelectorAll<HTMLElement>('[data-confetti]')).map((bit, i) =>
      animate(bit, {
        x: utils.random(-340, 340),
        y: [
          { to: utils.random(-320, -120), duration: 650, ease: 'outCubic' },
          { to: utils.random(280, 560), duration: 1500, ease: 'inQuad' },
        ],
        rotate: utils.random(-600, 600),
        opacity: [{ to: 1, duration: 40 }, { to: 0, duration: 500, delay: 1500 }],
        delay: 450 + i * 9,
      }),
    );
    return () => {
      intro.revert();
      for (const burst of bursts) burst.revert();
    };
  }, [isAnimated]);

  const hidden = isAnimated ? { opacity: 0 } : undefined;
  const isEmpty = providers && !providers.flatrate.length && !providers.rent.length && !providers.buy.length;

  return (
    <section ref={root} className="relative flex flex-col items-center gap-8 pb-8 text-center">
      <div
        data-part="spot"
        aria-hidden
        style={hidden}
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 size-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(255_231_184/0.30),rgb(246_183_60/0.08)_45%,transparent_65%)]"
      />
      {isAnimated && (
        <div aria-hidden className="pointer-events-none absolute top-36 left-1/2 z-20">
          {Array.from({ length: CONFETTI }, (_, i) => (
            <span
              key={i}
              data-confetti
              className="absolute block h-3 w-1.5 rounded-[1px] opacity-0"
              style={{ background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }}
            />
          ))}
        </div>
      )}

      <div data-part="heading" style={hidden}>
        <ShimmerText text="It's a match!" className="font-display text-7xl leading-none font-extrabold sm:text-8xl" />
        <p className="mt-2 text-cream/75">Everyone liked it. Tonight you&apos;re watching</p>
      </div>

      <div data-part="stub" style={hidden} className="ticket w-full max-w-md rounded-[22px] text-left [--notch-y:calc(100%-58px)]">
        <div className="flex gap-4 p-4">
          <div className="aspect-[2/3] w-28 shrink-0">
            <MovieCardView movieId={movieId} variant="peek" className="rounded-xl" />
          </div>
          <div className="flex min-w-0 flex-col justify-center">
            <p className="text-sm text-paper-ink/60">Admit the whole room</p>
            <h3 className="font-display text-4xl leading-[0.95] font-extrabold text-paper-ink">{movie?.title ?? 'Loading…'}</h3>
            {movie?.year && <p className="mt-1 font-medium text-[#8f4a3a]">{movie.year}</p>}
          </div>
        </div>
        <div data-part="tear" className="perforation mx-5 origin-left" />
        <div className="flex justify-between px-6 py-3 font-display text-lg font-bold text-paper-ink/70">
          <span>Room {code}</span>
          <span>{today}</span>
        </div>
      </div>

      <div data-part="rest" style={hidden} className="flex w-full flex-col items-center gap-10">
        <div className="w-full max-w-md">
          <h3 className="font-display text-3xl font-bold text-tungsten">Where to watch</h3>
          {hasFailed && <p className="mt-2 text-sm text-cream/70">{"Couldn't load where it's streaming."}</p>}
          {isEmpty && <p className="mt-2 text-sm text-cream/70">Not streaming in India right now.</p>}
          {providers && (
            <div className="mt-4 space-y-4">
              <ProviderList title="Stream" items={providers.flatrate} isFeatured />
              <ProviderList title="Rent" items={providers.rent} />
              <ProviderList title="Buy" items={providers.buy} />
              {providers.link && (
                <a href={providers.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-marquee hover:underline">
                  All watch options
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              )}
              <p className="text-xs text-cream/45">Streaming data by JustWatch</p>
            </div>
          )}
        </div>
        <RoomRecap progress={progress} matchedMovieId={movieId} />
      </div>
    </section>
  );
}

function ProviderList({ title, items, isFeatured = false }: { title: string; items: ProviderView[]; isFeatured?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-sm text-cream/60">{title}</h4>
      <ul className="flex flex-wrap justify-center gap-3">
        {items.map((p) => (
          <li
            key={p.id}
            className={
              isFeatured
                ? 'flex items-center gap-2.5 rounded-2xl bg-curtain/80 px-4 py-2.5 font-medium text-tungsten ring-1 ring-marquee/50 shadow-[0_0_30px_-8px_rgb(246_183_60/0.6)]'
                : 'flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2 text-sm text-cream/85 ring-1 ring-tungsten/10'
            }
          >
            {p.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- tiny TMDB logo
              <img src={p.logoUrl} alt="" className={isFeatured ? 'size-8 rounded-lg' : 'size-6 rounded'} />
            )}
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
