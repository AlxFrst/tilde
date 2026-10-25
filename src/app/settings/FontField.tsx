import { useId, useMemo } from 'react';
import { t } from '@/i18n';
import { BUNDLED_FONTS, canvasMeasure, isFontAvailable } from '@/themes/fonts';
import { Row, TextField } from './fields';

/** A font name with suggestions; warns when the font is not installed. */
export function FontField({
  setting,
  label,
  value,
  suggestions,
  disabled,
  onChange,
}: {
  setting: string;
  label: string;
  value: string;
  suggestions: readonly string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const listId = useId();
  const missing = useMemo(() => {
    if (BUNDLED_FONTS.includes(value)) return false;
    const measure = canvasMeasure();
    return measure ? !isFontAvailable(value, measure) : false;
  }, [value]);
  return (
    <Row
      label={label}
      hint={
        missing
          ? t('Police introuvable sur ce système : une police de repli est utilisée.')
          : undefined
      }
    >
      <TextField
        setting={setting}
        label={label}
        value={value}
        list={listId}
        disabled={disabled}
        onChange={(v) => {
          if (v) onChange(v);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </Row>
  );
}
