import { mix } from '../derive';
import { ThemeError } from '../parse';
import type { TerminalColors } from '../types';

/** What a format parser extracts before validation by `parseThemeFile`. */
export interface RawScheme {
  name: string;
  terminal: Partial<Record<keyof TerminalColors, string>>;
}

/** The 16 ANSI keys, in palette order (0 to 15). */
export const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies readonly (keyof TerminalColors)[];

/** `#RRGGBB` (upper case) from `rrggbb`, `#rrggbb`, or `undefined` if it is neither. */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m?.[1] ? `#${m[1].toUpperCase()}` : undefined;
}

/** Fills cursor and selection from foreground/background when a format omits them. */
export function withDefaults(t: RawScheme['terminal']): RawScheme['terminal'] {
  const { foreground: fg, background: bg } = t;
  if (!fg || !bg) return t;
  return {
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: `${mix(fg, bg, 0.25)}`,
    ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)),
  };
}

export function fail(message: string): never {
  throw new ThemeError(message);
}
