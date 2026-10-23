import type { ITheme } from '@xterm/xterm';
import type { ThemeDefinition } from './types';
import { toXtermTheme } from './xterm';

/** `#RRGGBB` with an alpha byte (`alpha` from 0 to 1); fully opaque stays `#RRGGBB`. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hex.slice(0, 7);
  if (alpha >= 1) return rgb;
  const byte = Math.round(Math.max(0, alpha) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${rgb}${byte}`;
}

/** The xterm theme, with a translucent background when the window opacity is below 1. */
export function terminalTheme(theme: ThemeDefinition, opacity: number): ITheme {
  const base = toXtermTheme(theme.terminal);
  return opacity >= 1
    ? base
    : { ...base, background: withAlpha(theme.terminal.background, opacity) };
}
