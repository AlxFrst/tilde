import { getTheme, toXtermTheme, type ThemeDefinition } from '@/themes';
import { terminalTheme, withAlpha } from './opacity';

const tilde = getTheme('tilde-dark') as ThemeDefinition;

test('withAlpha appends the alpha byte', () => {
  expect(withAlpha('#0B0E14', 0.8)).toBe('#0B0E14CC');
  expect(withAlpha('#0B0E14', 0.3)).toBe('#0B0E144D');
  expect(withAlpha('#0B0E14', 1)).toBe('#0B0E14');
  // An existing alpha is replaced, not appended to.
  expect(withAlpha('#0B0E14FF', 0.5)).toBe('#0B0E1480');
});

test('terminal theme gets transparent background below 1', () => {
  expect(terminalTheme(tilde, 1)).toEqual(toXtermTheme(tilde.terminal));
  expect(terminalTheme(tilde, 0.8).background).toBe('#0B0E14CC');
  expect(terminalTheme(tilde, 0.8).foreground).toBe(tilde.terminal.foreground);
});
