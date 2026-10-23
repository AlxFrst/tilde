// French units for the monitor (binary prefixes: 1 Kio = 1024 o).

const UNITS = ['o', 'Kio', 'Mio', 'Gio', 'Tio', 'Pio'];

export function formatBytes(n: number): string {
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text =
    unit === 0
      ? String(Math.round(value))
      : value.toLocaleString('fr-FR', { maximumFractionDigits: value < 100 ? 1 : 0 });
  return `${text} ${UNITS[unit] ?? 'o'}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${String(days)} j ${String(hours)} h`;
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`;
  return minutes > 0 ? `${String(minutes)} min` : '< 1 min';
}
