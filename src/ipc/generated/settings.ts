/* Généré par scripts/gen-types.mjs depuis schemas/settings.schema.json — ne pas éditer. */

export interface Settings {
  version: number;
  appearance: Appearance;
  terminal: Terminal;
  ssh: Ssh;
  sftp: Sftp;
  general: General;
}
export interface Appearance {
  colorScheme: 'system' | 'dark' | 'light';
  themeDark: string;
  themeLight: string;
  uiFontFamily: string;
  uiFontSize: number;
  density: 'compact' | 'comfortable' | 'spacious';
  sidebarPosition: 'left' | 'right';
  sidebarWidth: number;
  window: WindowAppearance;
}
export interface WindowAppearance {
  effect: 'none' | 'mica' | 'acrylic' | 'vibrancy';
  opacity: number;
}
export interface Terminal {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  ligatures: boolean;
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  scrollback: number;
  defaultProfile: string | null;
  copyOnSelect: boolean;
  rightClick: 'menu' | 'paste' | 'copyPaste';
  confirmClose: boolean;
}
export interface Ssh {
  keepaliveIntervalSecs: number;
  keepaliveCountMax: number;
  autoReconnect: boolean;
  confirmCloseSsh: boolean;
}
export interface Sftp {
  concurrency: number;
  editorMode: 'external' | 'builtin';
  externalEditor: string | null;
}
export interface General {
  restoreSession: boolean;
  quake: Quake;
}
export interface Quake {
  enabled: boolean;
  shortcut: string;
}
