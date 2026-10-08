import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  children: ReactNode;
  /** Small line printed on the stub, like a seat or room number. */
  stub?: ReactNode;
  className?: string;
  /** Vertical position of the side notches, so they line up with the perforation. */
  notchY?: number;
};

/** Cream ticket paper with side notches and a perforated stub. */
export function Ticket({ children, stub, className, notchY = 64 }: Props) {
  return (
    <div className={cn('ticket rounded-[20px]', className)} style={{ '--notch-y': `${notchY}px` } as CSSProperties}>
      {stub && (
        <>
          <div className="flex h-[52px] items-end justify-between px-6 pb-3 font-display text-lg font-bold tracking-wide text-paper-ink/80">
            {stub}
          </div>
          <div className="perforation mx-5" />
        </>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
