'use client';

import { type HTMLMotionProps, motion } from 'motion/react';
import { cn } from '@/lib/utils';

type Props = HTMLMotionProps<'button'> & { tone?: 'marquee' | 'ink' };

/** Primary action: marquee amber on the velvet house, velvet ink on ticket paper. */
export function MarqueeButton({ tone = 'marquee', className, ...props }: Props) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 font-display text-xl font-bold tracking-wide transition-shadow duration-300 disabled:pointer-events-none disabled:opacity-60',
        tone === 'marquee'
          ? 'bg-marquee text-velvet shadow-[0_0_0_1px_rgb(255_231_184/0.6),0_12px_40px_-10px_rgb(246_183_60/0.75)] hover:shadow-[0_0_0_1px_rgb(255_231_184/0.9),0_14px_60px_-8px_rgb(246_183_60/0.95)]'
          : 'bg-velvet text-tungsten shadow-[0_12px_30px_-12px_rgb(27_11_18/0.9)] hover:bg-curtain',
        className,
      )}
      {...props}
    />
  );
}
