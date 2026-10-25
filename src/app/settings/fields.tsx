// Building blocks of the settings page. Every control carries `data-setting="<path>"`
// (its key in settings.json), which the tests use to check that no setting is missing.

import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { localeTag, t } from '@/i18n';
import { cn } from '@/lib/utils';

/** Option labels kept in constants (marked with msg()), in the interface's language. */
export function translated<T extends string>(
  options: readonly (readonly [T, string])[],
): (readonly [T, string])[] {
  return options.map(([value, label]) => [value, t(label)] as const);
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-medium tracking-wide text-text-muted uppercase">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-text-muted">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Choice<T extends string>({
  setting,
  label,
  value,
  options,
  disabled,
  unavailable = [],
  onChange,
}: {
  setting: string;
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  disabled: boolean;
  /** Options shown but not selectable (with a tooltip). */
  unavailable?: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      data-setting={setting}
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        // Radix reports '' when the active item is clicked again; keep the current value.
        if (v) onChange(v as T);
      }}
    >
      {options.map(([v, text]) => {
        const off = unavailable.includes(v);
        return (
          <ToggleGroupItem
            key={v}
            value={v}
            aria-label={text}
            disabled={disabled || off}
            title={off ? t('Non pris en charge sur ce système') : undefined}
            className="px-3"
          >
            {text}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export function SwitchField({
  setting,
  label,
  checked,
  disabled,
  onChange,
}: {
  setting: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-setting={setting}
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          'inline-block size-3.5 rounded-full bg-text shadow transition-transform',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** A number checked against the schema bounds; committed on Enter or blur. */
export function NumberField({
  setting,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onChange,
}: {
  setting: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** 1 for integers; decimals otherwise. */
  step?: number;
  unit?: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
    setError(null);
  }
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    const fmt = (x: number) => x.toLocaleString(localeTag());
    if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
      setError(t('entre {min} et {max}', { min: fmt(min), max: fmt(max) }));
      return;
    }
    if (step === 1 && !Number.isInteger(n)) {
      setError(t('nombre entier attendu'));
      return;
    }
    setError(null);
    if (n !== value) onChange(n);
  };
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-error">{error}</span>}
      <Input
        data-setting={setting}
        aria-label={label}
        aria-invalid={error !== null}
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        className="h-7 w-24 text-right"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {unit && <span className="text-xs text-text-muted">{unit}</span>}
    </span>
  );
}

/** Free text committed on Enter or blur; empty means `null` when `nullable`. */
export function TextField({
  setting,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  className,
  list,
}: {
  setting: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (v: string) => void;
  className?: string;
  list?: string;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => {
    const v = text.trim();
    if (v !== value) onChange(v);
  };
  return (
    <Input
      data-setting={setting}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      list={list}
      className={cn('h-7 w-64', className)}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.currentTarget.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function SelectField({
  setting,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  setting: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger data-setting={setting} size="sm" className="w-56" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
