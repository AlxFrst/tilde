export type ThemeKind = 'dark' | 'light';

/** UI design tokens, as `#RRGGBB`. Exposed to CSS as `--tilde-<kebab-name>`. */
export interface UiTokens {
  bg: string;
  surface1: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  success: string;
  warning: string;
  error: string;
}

/** Terminal palette: 16 ANSI colors plus cursor and selection (`#RRGGBBAA`). */
export interface TerminalColors {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  kind: ThemeKind;
  ui: UiTokens;
  terminal: TerminalColors;
}
