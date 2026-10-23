import { useState } from 'react';
import { Input } from '@/components/ui/input';

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/**
 * A color as a native picker plus a hex field. `alpha` accepts `#RRGGBBAA` (the picker
 * edits the color and keeps the alpha). Only valid values reach `onChange`.
 */
export function ColorField({
  label,
  value,
  alpha = false,
  onChange,
}: {
  label: string;
  value: string;
  alpha?: boolean;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  // Follow outside changes (« Dériver… », the picker) without an effect.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const valid = (alpha ? HEX8 : HEX6).test(text);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        value={value.slice(0, 7).toLowerCase()}
        onChange={(e) => {
          const next = `${e.currentTarget.value.toUpperCase()}${value.slice(7)}`;
          setText(next);
          onChange(next);
        }}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Input
        aria-label={`${label} (hex)`}
        aria-invalid={!valid}
        spellCheck={false}
        maxLength={alpha ? 9 : 7}
        className="h-7 w-24 font-mono text-xs"
        value={text}
        onChange={(e) => {
          const next = e.currentTarget.value.trim();
          setText(next);
          if ((alpha ? HEX8 : HEX6).test(next)) onChange(next.toUpperCase());
        }}
      />
    </div>
  );
}
