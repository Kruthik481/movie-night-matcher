'use client';

import type { MemberView } from '@mnm/shared';
import { Crown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { SPRING } from './motion';

/** Stable warm hue per nickname so friends keep their color across visits. */
function hueFor(nickname: string): number {
  let hash = 0;
  for (const ch of nickname) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const warm = [8, 22, 34, 44, 330, 345, 18, 290];
  return warm[hash % warm.length] ?? 30;
}

export function MemberOrb({ member, size = 'md' }: { member: MemberView; size?: 'sm' | 'md' }) {
  const reduce = useReducedMotion();
  const hue = hueFor(member.nickname);
  const isSmall = size === 'sm';

  return (
    <motion.div
      layout
      initial={reduce ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: member.isActive ? 1 : 0.45 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={SPRING}
      className="flex flex-col items-center gap-2"
    >
      <div className="relative">
        {member.isActive && !reduce && !isSmall && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: `hsl(${hue} 85% 65%)` }}
            animate={{ scale: [1, 1.45], opacity: [0.7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <div
          className={cn(
            'grid place-items-center rounded-full font-display font-extrabold text-velvet uppercase ring-2 ring-velvet',
            isSmall ? 'size-8 text-sm' : 'size-16 text-2xl',
          )}
          style={{ background: `radial-gradient(circle at 30% 25%, hsl(${hue} 95% 85%), hsl(${hue} 80% 55%) 60%, hsl(${hue} 70% 32%))` }}
        >
          {member.nickname.slice(0, 1)}
        </div>
        {member.isHost && (
          <Crown
            aria-label="Host"
            className={cn('absolute -top-2 -right-1 rotate-12 fill-marquee text-marquee drop-shadow', isSmall ? 'size-3.5' : 'size-5')}
          />
        )}
      </div>
      {!isSmall && <span className="max-w-24 truncate text-sm text-cream">{member.nickname}</span>}
    </motion.div>
  );
}
