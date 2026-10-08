import type { Option } from '@/lib/catalog';

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
      <legend className="mb-2 text-sm text-zinc-400">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(option.id)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                isOn ? 'border-amber-400 bg-amber-400 text-zinc-950' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
