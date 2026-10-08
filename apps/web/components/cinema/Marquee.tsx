'use client';

import { animate, createTimeline, stagger } from 'animejs';
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

const BULBS_PER_ROW = 16;
const BULBS_PER_COLUMN = 4;

function BulbRow({ count, vertical = false }: { count: number; vertical?: boolean }) {
  return (
    <div className={vertical ? 'flex flex-col justify-between py-3' : 'flex justify-between px-3'} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-bulb className="bulb block size-2 rounded-full sm:size-2.5" />
      ))}
    </div>
  );
}

/** The theater sign: bulbs light up around the frame, then the letters flicker on. */
export function Marquee({ title, tagline }: { title: string; tagline: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const bulbs = el.querySelectorAll('[data-bulb]');
    const letters = el.querySelectorAll('[data-letter]');

    const intro = createTimeline({ defaults: { ease: 'outQuad' } })
      .add(bulbs, { opacity: [0.12, 1], duration: 80, delay: stagger(18) })
      .add(
        letters,
        {
          opacity: [
            { to: 0.25, duration: 70 },
            { to: 1, duration: 60 },
            { to: 0.5, duration: 50 },
            { to: 1, duration: 140 },
          ],
          delay: stagger(60, { from: 'random' }),
        },
        '-=500',
      );
    const chase = animate(bulbs, {
      opacity: [1, 0.35, 1],
      duration: 1600,
      delay: stagger(70),
      loop: true,
      ease: 'inOutSine',
      autoplay: false,
    });
    void intro.then(() => chase.play());

    return () => {
      intro.revert();
      chase.revert();
    };
  }, []);

  return (
    <div ref={root} className="mx-auto w-full max-w-3xl">
      <div className="rounded-[28px] border border-marquee/30 bg-gradient-to-b from-curtain/80 to-velvet/90 shadow-[0_0_80px_-20px_rgb(246_183_60/0.45)]">
        <BulbRow count={BULBS_PER_ROW} />
        <div className="flex">
          <BulbRow count={BULBS_PER_COLUMN} vertical />
          <div className="flex-1 px-4 py-6 text-center sm:py-8">
            <h1
              aria-label={title}
              className="font-display text-[clamp(3.2rem,11vw,7.5rem)] leading-[0.85] font-extrabold tracking-tight text-tungsten uppercase [text-shadow:0_0_24px_rgb(246_183_60/0.55),0_0_2px_rgb(255_231_184/0.9)]"
            >
              {title.split('').map((char, i) => (
                <span key={i} data-letter aria-hidden className="inline-block whitespace-pre">
                  {char}
                </span>
              ))}
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base text-cream/80 sm:text-lg">{tagline}</p>
          </div>
          <BulbRow count={BULBS_PER_COLUMN} vertical />
        </div>
        <BulbRow count={BULBS_PER_ROW} />
      </div>
    </div>
  );
}
