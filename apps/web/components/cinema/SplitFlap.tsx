'use client';

import { animate, utils } from 'animejs';
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Room code that rattles into place like a departures board. */
export function SplitFlap({ code }: { code: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const tiles = Array.from(el.querySelectorAll<HTMLSpanElement>('[data-tile]'));
    const runs = tiles.flatMap((tile, i) => {
      const final = tile.dataset.char ?? '';
      const counter = { t: 0 };
      return [
        animate(counter, {
          t: 1,
          duration: 420 + i * 160,
          ease: 'linear',
          onUpdate: () => {
            tile.textContent = GLYPHS[utils.random(0, GLYPHS.length - 1)] ?? final;
          },
          onComplete: () => {
            tile.textContent = final;
          },
        }),
        animate(tile, { rotateX: [-90, 0], duration: 380, delay: 420 + i * 160, ease: 'outBack' }),
      ];
    });
    return () => {
      for (const run of runs) run.revert();
      for (const tile of tiles) tile.textContent = tile.dataset.char ?? '';
    };
  }, [code]);

  return (
    <div ref={root} className="flex justify-center gap-1.5 sm:gap-2" style={{ perspective: 600 }}>
      <span className="sr-only">{code}</span>
      {code.split('').map((char, i) => (
        <span
          key={`${code}-${i}`}
          data-tile
          data-char={char}
          aria-hidden
          className="relative grid h-16 w-11 place-items-center rounded-lg bg-velvet font-display text-4xl font-extrabold text-tungsten shadow-[inset_0_-2px_0_rgb(0_0_0/0.6),0_8px_16px_-8px_rgb(0_0_0/0.8)] after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-black/60 sm:h-20 sm:w-14 sm:text-5xl"
        >
          {char}
        </span>
      ))}
    </div>
  );
}
