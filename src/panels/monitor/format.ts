// Units for the monitor (binary prefixes: 1 Kio = 1024 o, 1 KiB = 1024 B).

import { localeTag, t, useLocale } from '@/i18n';

const UNITS = {
  fr: ['o', 'Kio', 'Mio', 'Gio', 'Tio', 'Pio'],
  en: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
};

export function formatBytes(n: number): string {
  const units = UNITS[useLocale.getState().locale];
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text =
    unit === 0
      ? String(Math.round(value))
      : value.toLocaleString(localeTag(), { maximumFractionDigits: value < 100 ? 1 : 0 });
  return `${text} ${units[unit] ?? units[0] ?? ''}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return t('{days} j {hours} h', { days, hours });
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`;
  return minutes > 0 ? `${String(minutes)} min` : '< 1 min';
}
