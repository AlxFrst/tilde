import { renderHook } from '@testing-library/react';
import { applyTheme } from './apply';
import { contrastRatio } from './contrast';
import { builtinThemes, getTheme } from './registry';
import { useResolvedTheme } from './useResolvedTheme';

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

function mockPrefersDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

test('every builtin theme has all tokens as valid hex', () => {
  const ids = builtinThemes.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const theme of builtinThemes) {
    for (const [key, value] of [...Object.entries(theme.ui), ...Object.entries(theme.terminal)]) {
      expect(value, `${theme.id}.${key}`).toMatch(HEX);
    }
  }
  expect(ids).toEqual(
    expect.arrayContaining([
      'tilde-dark',
      'tilde-light',
      'catppuccin-mocha',
      'catppuccin-latte',
      'tokyo-night',
      'tokyo-night-day',
      'dracula',
      'nord',
      'gruvbox-dark',
      'gruvbox-light',
      'one-dark',
      'one-light',
      'rose-pine',
      'rose-pine-dawn',
    ]),
  );
});

test('every kind has at least four themes', () => {
  expect(builtinThemes.filter((t) => t.kind === 'dark').length).toBeGreaterThanOrEqual(4);
  expect(builtinThemes.filter((t) => t.kind === 'light').length).toBeGreaterThanOrEqual(4);
});

test.each(builtinThemes.map((t) => [t.id, t] as const))(
  'text contrast meets WCAG AA (%s)',
  (_id, theme) => {
    expect(contrastRatio(theme.ui.text, theme.ui.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.ui.textMuted, theme.ui.bg)).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(theme.terminal.foreground, theme.terminal.background),
    ).toBeGreaterThanOrEqual(4.5);
  },
);

test('applyTheme writes css variables', () => {
  const el = document.createElement('div');
  const theme = getTheme('tilde-dark');
  if (!theme) throw new Error('tilde-dark missing');
  applyTheme(theme, el);
  expect(el.style.getPropertyValue('--tilde-surface-1')).toBe('#11151C');
  expect(el.style.getPropertyValue('--tilde-text-muted')).toBe('#8B93A7');
  expect(el.dataset.themeKind).toBe('dark');
});

test('unknown theme id falls back', () => {
  mockPrefersDark(true);
  const { result } = renderHook(() =>
    useResolvedTheme({ colorScheme: 'system', themeDark: 'nope', themeLight: 'tilde-light' }),
  );
  expect(result.current.id).toBe('tilde-dark');
});

test('system scheme follows the OS preference', () => {
  mockPrefersDark(false);
  const { result } = renderHook(() =>
    useResolvedTheme({
      colorScheme: 'system',
      themeDark: 'catppuccin-mocha',
      themeLight: 'catppuccin-latte',
    }),
  );
  expect(result.current.id).toBe('catppuccin-latte');
});
