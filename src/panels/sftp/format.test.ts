import { setLocale } from '@/i18n';
import { formatDate, formatMode, formatProgress, formatSize } from './format';

test('progress text formats size speed and remaining time', () => {
  expect(formatSize(0)).toBe('0 o');
  expect(formatSize(1536)).toBe('1,5 Kio');
  expect(formatProgress(10 * 1024 ** 2, 40 * 1024 ** 2, 2 * 1024 ** 2)).toBe(
    '10 Mio / 40 Mio — 2 Mio/s — 15 s',
  );
  expect(formatProgress(0, 600 * 1024 ** 2, 1024 ** 2)).toBe(
    '0 o / 600 Mio — 1 Mio/s — 10 min 0 s',
  );
  expect(formatProgress(5, 10, 0)).toBe('5 o / 10 o');
});

test('permissions read like ls', () => {
  expect(formatMode(0o755, 'dir')).toBe('drwxr-xr-x');
  expect(formatMode(0o640, 'file')).toBe('-rw-r-----');
  expect(formatMode(null, 'file')).toBe('');
});

test('sizes and dates follow the interface language', () => {
  const secs = new Date(2026, 9, 23, 14, 5).getTime() / 1000;
  const fr = formatDate(secs);
  setLocale('en');
  expect(formatSize(0)).toBe('0 B');
  expect(formatSize(1536)).toBe('1.5 KiB');
  expect(formatProgress(10 * 1024 ** 2, 40 * 1024 ** 2, 2 * 1024 ** 2)).toBe(
    '10 MiB / 40 MiB — 2 MiB/s — 15 s',
  );
  expect(formatDate(secs)).not.toBe(fr);
  expect(formatDate(secs)).toMatch(/^10\/23\/26/);
});
