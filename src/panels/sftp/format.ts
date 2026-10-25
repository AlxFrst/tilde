import { localeTag, useLocale } from '@/i18n';

const UNITS = {
  fr: ['o', 'Kio', 'Mio', 'Gio', 'Tio'],
  en: ['B', 'KiB', 'MiB', 'GiB', 'TiB'],
};

/** Formatters by locale tag, created on first use. */
const numbers = new Map<string, Intl.NumberFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();

function numberFormat(): Intl.NumberFormat {
  const tag = localeTag();
  let f = numbers.get(tag);
  if (!f) {
    f = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
    numbers.set(tag, f);
  }
  return f;
}

function dateFormat(): Intl.DateTimeFormat {
  const tag = localeTag();
  let f = dates.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' });
    dates.set(tag, f);
  }
  return f;
}

/** 1536 → « 1,5 Kio » (« 1.5 KiB » in English). */
export function formatSize(bytes: number): string {
  const units = UNITS[useLocale.getState().locale];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : numberFormat().format(value)} ${units[unit] ?? ''}`;
}

/** Seconds since the epoch → « 23/10/2026 14:05 ». */
export const formatDate = (secs: number | null) =>
  secs === null ? '' : dateFormat().format(new Date(secs * 1000));

/** 0o755 + dir → « drwxr-xr-x ». */
export function formatMode(mode: number | null, kind: string): string {
  if (mode === null) return '';
  const type = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-';
  const bits = ['r', 'w', 'x'];
  let out = type;
  for (let i = 8; i >= 0; i--) out += mode & (1 << i) ? (bits[(8 - i) % 3] ?? '-') : '-';
  return out;
}

/** « 4,1 Mio/s », and the time left in a short form. */
export function formatProgress(done: number, total: number, perSec: number): string {
  const sizes = `${formatSize(done)} / ${formatSize(total)}`;
  if (perSec <= 0) return sizes;
  const left = Math.max(0, Math.ceil((total - done) / perSec));
  const eta =
    left >= 3600
      ? `${String(Math.floor(left / 3600))} h ${String(Math.floor((left % 3600) / 60))} min`
      : left >= 60
        ? `${String(Math.floor(left / 60))} min ${String(left % 60)} s`
        : `${String(left)} s`;
  return `${sizes} — ${formatSize(perSec)}/s — ${eta}`;
}
