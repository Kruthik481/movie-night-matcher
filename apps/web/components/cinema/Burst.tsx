'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const PARTICLES = 10;

/**
 * Sparks flying out of a button, adapted from KokonutUI's particle-button.
 * Render inside a `relative` parent and bump `trigger` to fire again.
 */
export function Burst({ trigger, color = 'var(--marquee)' }: { trigger: number; color?: string }) {
  const reduce = useReducedMotion();
  if (reduce || trigger === 0) return null;

  return (
    <AnimatePresence>
      <span key={trigger} aria-hidden className="pointer-events-none absolute inset-0">
        {Array.from({ length: PARTICLES }, (_, i) => {
          const angle = (i / PARTICLES) * Math.PI * 2;
          const distance = 46 + (i % 3) * 14;
          return (
            <motion.span
              key={i}
              className="absolute top-1/2 left-1/2 size-1.5 rounded-full"
              style={{ background: color, boxShadow: `0 0 8px ${color}` }}
              initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
              animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, scale: [0, 1.4, 0], opacity: [1, 1, 0] }}
              transition={{ duration: 0.65, ease: 'easeOut' }}
            />
          );
        })}
      </span>
    </AnimatePresence>
  );
}
