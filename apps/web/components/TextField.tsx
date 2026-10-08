import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Props = { label: string } & InputHTMLAttributes<HTMLInputElement>;

/** Input printed on ticket paper. */
export function TextField({ label, className, ...input }: Props) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-paper-ink/70">{label}</span>
      <input
        {...input}
        className={cn(
          'w-full rounded-xl border border-paper-ink/20 bg-white/45 px-4 py-3 text-base text-paper-ink outline-none transition placeholder:text-paper-ink/40 focus:border-curtain focus:bg-white/70 focus:ring-2 focus:ring-marquee/60',
          className,
        )}
      />
    </label>
  );
}
