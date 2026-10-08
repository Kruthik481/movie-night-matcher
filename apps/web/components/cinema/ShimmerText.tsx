'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Heading with light sweeping across it, adapted from KokonutUI's shimmer-text in house colors. */
export function ShimmerText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.h2
      className={cn(
        'bg-[length:200%_100%] bg-gradient-to-r from-marquee via-tungsten to-marquee bg-clip-text text-transparent',
        className,
      )}
      animate={reduce ? undefined : { backgroundPosition: ['200% center', '-200% center'] }}
      transition={{ duration: 3, ease: 'linear', repeat: Infinity }}
    >
      {text}
    </motion.h2>
  );
}
