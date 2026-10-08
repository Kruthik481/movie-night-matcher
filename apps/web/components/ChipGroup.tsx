'use client';

import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Option } from '@/lib/catalog';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  options: readonly Option[];
  selected: number[];
  onChange: (next: number[]) => void;
};

export function ChipGroup({ label, options, selected, onChange }: Props) {
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-paper-ink/70">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <motion.button
              key={option.id}
              type="button"
              layout
              whileTap={{ scale: 0.92 }}
              aria-pressed={isOn}
              onClick={() => toggle(option.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                isOn
                  ? 'border-velvet bg-velvet text-tungsten shadow-[0_6px_16px_-8px_rgb(27_11_18/0.9)]'
                  : 'border-paper-ink/25 text-paper-ink hover:border-paper-ink/60',
              )}
            >
              <AnimatePresence initial={false}>
                {isOn && (
                  <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }}>
                    <Check aria-hidden className="size-3.5 text-marquee" />
                  </motion.span>
                )}
              </AnimatePresence>
              {option.name}
            </motion.button>
          );
        })}
      </div>
    </fieldset>
  );
}
