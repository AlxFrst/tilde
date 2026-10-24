import { Ban, Check } from 'lucide-react';
import { CONNECTION_COLORS } from '@/connections/colors';
import { cn, SELECTED } from '@/lib/utils';
import { contrastRatio } from '@/themes';

/** Black or white, whichever reads better on `color`. */
const inkOn = (color: string) =>
  contrastRatio('#000000', color) >= contrastRatio('#FFFFFF', color) ? '#000000' : '#FFFFFF';

/** A row of colour swatches (radio group) plus « Aucune ». The chosen one is ticked. */
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
      {CONNECTION_COLORS.map(([name, color]) => {
        const checked = value?.toUpperCase() === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={name}
            title={name}
            className={cn(swatch, checked && 'ring-2 ring-ring')}
            style={{ background: color }}
            onClick={() => {
              onChange(color);
            }}
          >
            {checked && (
              <Check className="size-3.5" strokeWidth={3} style={{ color: inkOn(color) }} />
            )}
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="Aucune"
        title="Aucune"
        className={cn(
          swatch,
          'border text-text-muted',
          value === null && [SELECTED, 'ring-2 ring-ring'],
        )}
        onClick={() => {
          onChange(null);
        }}
      >
        <Ban className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
