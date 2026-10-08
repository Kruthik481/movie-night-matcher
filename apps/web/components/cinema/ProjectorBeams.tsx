'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';

const BEAMS = 9;
const MOTES = 22;

/**
 * Projector light falling from the top of the screen, adapted from KokonutUI's background-paths:
 * the flowing paths become a fan of beams, with dust motes drifting through them.
 */
export function ProjectorBeams() {
  const reduce = useReducedMotion();
  const beams = useMemo(
    () =>
      Array.from({ length: BEAMS }, (_, i) => {
        const spread = (i - (BEAMS - 1) / 2) * 130;
        return {
          d: `M 600 -40 Q ${600 + spread * 0.4} 300 ${600 + spread * 1.6} 900`,
          width: 60 + (i % 3) * 30,
          duration: 6 + (i % 4) * 1.7,
        };
      }),
    [],
  );
  const motes = useMemo(
    () =>
      Array.from({ length: MOTES }, (_, i) => ({
        left: `${30 + ((i * 37) % 40)}%`,
        top: `${(i * 53) % 90}%`,
        size: 1 + (i % 3),
        duration: 9 + (i % 5) * 2,
        delay: (i % 7) * 0.8,
      })),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <svg className="absolute inset-x-0 top-0 h-[110%] w-full" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMin slice">
        <defs>
          <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe7b8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f6b73c" stopOpacity="0" />
          </linearGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        {beams.map((beam, i) => (
          <motion.path
            key={i}
            d={beam.d}
            stroke="url(#beam)"
            strokeWidth={beam.width}
            strokeLinecap="round"
            fill="none"
            filter="url(#soft)"
            initial={{ opacity: 0.05 }}
            animate={reduce ? { opacity: 0.1 } : { opacity: [0.04, 0.16, 0.06] }}
            transition={{ duration: beam.duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          />
        ))}
      </svg>
      {!reduce &&
        motes.map((mote, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-tungsten"
            style={{ left: mote.left, top: mote.top, width: mote.size, height: mote.size }}
            animate={{ y: [0, -60, 0], x: [0, 12, 0], opacity: [0, 0.7, 0] }}
            transition={{ duration: mote.duration, delay: mote.delay, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
    </div>
  );
}
