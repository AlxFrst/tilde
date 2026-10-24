import { connectionIcon } from '@/connections/icons';
import { cn, SELECTED } from '@/lib/utils';

/** A row of icons (radio group); each is drawn in `color` when there is one. */
export function IconPicker({
  label,
  icons,
  value,
  color,
  onChange,
}: {
  label: string;
  icons: readonly string[];
  value: string;
  color: string | null;
  onChange: (icon: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {icons.map((name) => {
        const Icon = connectionIcon(name);
        const checked = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={name}
            className={cn(
              'flex size-8 items-center justify-center rounded-md border',
              checked ? SELECTED : 'border-transparent hover:bg-surface-2',
            )}
            onClick={() => {
              onChange(name);
            }}
          >
            <Icon className="size-4" strokeWidth={1.5} style={color ? { color } : undefined} />
          </button>
        );
      })}
    </div>
  );
}
