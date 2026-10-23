import { Ban } from 'lucide-react';
import { CONNECTION_COLORS } from '@/connections/colors';
import { cn } from '@/lib/utils';

/** A row of colour swatches (radio group) plus « Aucune ». */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  label: string;
}) {
  const swatch =
    'flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-popover';
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {CONNECTION_COLORS.map(([name, color]) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value?.toUpperCase() === color}
          aria-label={name}
          title={name}
          className={cn(swatch, value?.toUpperCase() === color && 'ring-2 ring-ring')}
          style={{ background: color }}
          onClick={() => {
            onChange(color);
          }}
        />
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="Aucune"
        title="Aucune"
        className={cn(swatch, 'border text-text-muted', value === null && 'ring-2 ring-ring')}
        onClick={() => {
          onChange(null);
        }}
      >
        <Ban className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
