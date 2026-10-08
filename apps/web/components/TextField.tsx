import type { InputHTMLAttributes } from 'react';

type Props = { label: string } & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, className = '', ...input }: Props) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-zinc-400">{label}</span>
      <input
        {...input}
        className={`w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-amber-400 ${className}`}
      />
    </label>
  );
}
