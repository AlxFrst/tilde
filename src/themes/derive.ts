// UI tokens derived from a terminal palette, for themes that only define terminal
// colors (imports from iTerm2, Windows Terminal, base16…).

import { contrastRatio } from './contrast';
import type { TerminalColors, ThemeKind, UiTokens } from './types';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** `weight` of `a` mixed into `b`, in sRGB (alpha dropped). */
export function mix(a: string, b: string, weight: number): string {
  const [ca, cb] = [rgb(a), rgb(b)];
  return toHex(ca.map((v, i) => v * weight + (cb[i] ?? 0) * (1 - weight)));
}

/** Dark when white text reads better on it than black text. */
export function inferKind(background: string): ThemeKind {
  return contrastRatio('#FFFFFF', background) >= contrastRatio('#000000', background)
    ? 'dark'
    : 'light';
}

/** The fg/bg mix closest to the background that still reaches 3:1. */
function mutedText(fg: string, bg: string): string {
  for (let w = 0.5; w < 1; w += 0.05) {
    const c = mix(fg, bg, w);
    if (contrastRatio(c, bg) >= 3) return c;
  }
  return fg;
}

export function deriveUiTokens(terminal: TerminalColors): UiTokens {
  const bg = terminal.background.slice(0, 7).toUpperCase();
  const fg = terminal.foreground.slice(0, 7).toUpperCase();
  return {
    bg,
    surface1: mix(fg, bg, 0.04),
    surface2: mix(fg, bg, 0.08),
    border: mix(fg, bg, 0.14),
    text: fg,
    textMuted: mutedText(fg, bg),
    accent: terminal.blue,
    accent2: terminal.cyan,
    success: terminal.green,
    warning: terminal.yellow,
    error: terminal.red,
  };
}
