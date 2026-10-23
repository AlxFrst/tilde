import { formatBytes, formatRate, formatUptime } from './format';

test('formats bytes, rates and uptime in French', () => {
  expect(formatBytes(0)).toBe('0 o');
  expect(formatBytes(512)).toBe('512 o');
  expect(formatBytes(1536)).toBe('1,5 Kio');
  expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 Gio');
  expect(formatBytes(2 * 1024 ** 4)).toBe('2 Tio');
  expect(formatRate(2.3 * 1024 ** 2)).toBe('2,3 Mio/s');
  expect(formatUptime(30)).toBe('< 1 min');
  expect(formatUptime(12 * 60)).toBe('12 min');
  expect(formatUptime(4 * 3600 + 12 * 60)).toBe('4 h 12 min');
  expect(formatUptime(3 * 86400 + 4 * 3600 + 5)).toBe('3 j 4 h');
});
