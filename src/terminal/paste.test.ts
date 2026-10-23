import { needsPasteConfirmation, pastedLineCount } from './paste';

test('single line or trailing newline needs no confirmation', () => {
  expect(needsPasteConfirmation('ls', false)).toBe(false);
  expect(needsPasteConfirmation('ls\n', false)).toBe(false);
  expect(needsPasteConfirmation('ls\r\n', false)).toBe(false);
});

test('multi-line paste needs confirmation unless bracketed paste is on', () => {
  expect(needsPasteConfirmation('a\nb', false)).toBe(true);
  expect(needsPasteConfirmation('a\r\nb\r\n', false)).toBe(true);
  expect(needsPasteConfirmation('a\nb', true)).toBe(false);
});

test('pastedLineCount ignores a trailing newline', () => {
  expect(pastedLineCount('a\r\nb\n')).toBe(2);
  expect(pastedLineCount('a')).toBe(1);
});
