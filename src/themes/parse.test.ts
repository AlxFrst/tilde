import { contrastRatio } from './contrast';
import { deriveUiTokens, inferKind } from './derive';
import { parseThemeFile, serializeTheme, ThemeError } from './parse';
import { builtinThemes, getTheme } from './registry';
import type { TerminalColors } from './types';

function tilde() {
  const t = getTheme('tilde-dark');
  if (!t) throw new Error('tilde-dark missing');
  return t;
}

test.each(builtinThemes.map((t) => [t.id, t] as const))(
  'derives readable ui tokens from terminal colors (%s)',
  (_id, theme) => {
    const ui = deriveUiTokens(theme.terminal);
    expect(ui.bg).toBe(theme.terminal.background.slice(0, 7).toUpperCase());
    expect(contrastRatio(ui.text, ui.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ui.textMuted, ui.bg)).toBeGreaterThanOrEqual(3);
    expect(ui.accent).toBe(theme.terminal.blue);
  },
);

test('infers kind from background', () => {
  expect(inferKind('#000000')).toBe('dark');
  expect(inferKind('#1E1E2E')).toBe('dark');
  expect(inferKind('#FAFAFA')).toBe('light');
  expect(inferKind('#FBF1C7')).toBe('light');
});

test('parses a terminal-only theme', () => {
  const t = parseThemeFile({ name: 'Mine', terminal: tilde().terminal }, 'mine');
  expect(t.id).toBe('mine');
  expect(t.kind).toBe('dark');
  expect(t.ui.bg).toBe('#0B0E14');
  expect(t.ui.error).toBe(tilde().terminal.red);
});

test('keeps provided ui tokens', () => {
  const t = parseThemeFile({
    id: 'x',
    name: 'X',
    kind: 'light',
    ui: { accent: '#123456' },
    terminal: tilde().terminal,
  });
  expect(t.id).toBe('x');
  expect(t.kind).toBe('light');
  expect(t.ui.accent).toBe('#123456');
  expect(t.ui.text).toBe(tilde().terminal.foreground);
});

test('rejects bad colors naming the field', () => {
  const terminal = { ...tilde().terminal, red: 'red' };
  expect(() => parseThemeFile({ name: 'X', terminal }, 'x')).toThrow(ThemeError);
  expect(() => parseThemeFile({ name: 'X', terminal }, 'x')).toThrow(/terminal\.red/);
  expect(() =>
    parseThemeFile({ name: 'X', ui: { bg: '#12' }, terminal: tilde().terminal }, 'x'),
  ).toThrow(/ui\.bg/);
});

test('rejects missing terminal keys', () => {
  const partial: Partial<TerminalColors> = { ...tilde().terminal };
  delete partial.brightWhite;
  expect(() => parseThemeFile({ name: 'X', terminal: partial }, 'x')).toThrow(
    /terminal\.brightWhite/,
  );
  expect(() => parseThemeFile({ terminal: tilde().terminal }, 'x')).toThrow(/name/);
  expect(() => parseThemeFile(null, 'x')).toThrow(ThemeError);
  expect(() => parseThemeFile({ name: 'X', terminal: tilde().terminal })).toThrow(/id/);
});

test('serialize then parse roundtrips', () => {
  const t = tilde();
  const json = serializeTheme(t);
  expect(JSON.parse(json)).toMatchObject({ version: 1, id: 'tilde-dark' });
  expect(parseThemeFile(JSON.parse(json))).toEqual(t);
});
