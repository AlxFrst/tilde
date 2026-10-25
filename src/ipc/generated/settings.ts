/* Généré par scripts/gen-types.mjs depuis schemas/settings.schema.json — ne pas éditer. */

export interface Settings {
  version: number;
  appearance: Appearance;
  terminal: Terminal;
  ssh: Ssh;
  sftp: Sftp;
  general: General;
  /**
   * User profiles. One whose `id` matches a detected shell overrides it.
   */
  profiles: Profile[];
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
  sshConfigHosts: SshConfigHosts;
}
export interface WindowAppearance {
  effect: 'none' | 'mica' | 'acrylic' | 'vibrancy';
  opacity: number;
}
/**
 * Hosts of `~/.ssh/config` listed in the sidebar.
 */
export interface SshConfigHosts {
  /**
   * Aliases tucked away in the section's collapsed "Masqués" group (still adoptable).
   */
  hidden: string[];
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
  /**
   * The strip under SSH terminals with the server's CPU, memory, disk and network.
   */
  statusBar: boolean;
}
export interface Sftp {
  concurrency: number;
  editorMode: 'external' | 'builtin';
  externalEditor: string | null;
}
export interface General {
  /**
   * The interface's language. `Auto` follows the system: French on a French system,
   * English everywhere else.
   */
  language: 'auto' | 'fr' | 'en';
  restoreSession: boolean;
  quake: Quake;
  /**
   * Look for a new version on GitHub at startup (at most once a day).
   */
  checkUpdates: boolean;
  /**
   * "Ouvrir dans Tilde" in Windows Explorer's context menu (folders, drives, the
   * background of an open folder). Ignored on other systems.
   */
  explorerMenu: boolean;
}
export interface Quake {
  enabled: boolean;
  shortcut: string;
}
/**
 * A user-defined shell profile, or overrides for a detected one (same `id`).
 */
export interface Profile {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: {
    [k: string]: string | undefined;
  };
  icon: string | null;
  color: string | null;
  /**
   * Hides a detected shell from the profile list.
   */
  hidden: boolean;
}
