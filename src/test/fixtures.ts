import type { Settings } from '@/ipc/generated/settings';

/** Mirrors `Settings::default()` in crates/tilde-config. */
export const defaultSettings: Settings = {
  version: 1,
  appearance: {
    colorScheme: 'system',
    themeDark: 'tilde-dark',
    themeLight: 'tilde-light',
    uiFontFamily: 'Geist Variable',
    uiFontSize: 13,
    density: 'comfortable',
    sidebarPosition: 'left',
    sidebarWidth: 260,
    window: { effect: 'none', opacity: 1 },
    sshConfigHosts: { hidden: [] },
  },
  terminal: {
    fontFamily: 'JetBrains Mono Variable',
    fontSize: 14,
    lineHeight: 1.2,
    ligatures: true,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    defaultProfile: null,
    copyOnSelect: false,
    rightClick: 'menu',
    confirmClose: true,
  },
  ssh: {
    keepaliveIntervalSecs: 15,
    keepaliveCountMax: 3,
    autoReconnect: true,
    confirmCloseSsh: true,
    statusBar: true,
  },
  sftp: { concurrency: 3, editorMode: 'external', externalEditor: null },
  general: {
    language: 'auto',
    restoreSession: true,
    quake: { enabled: false, shortcut: 'Alt+F12' },
    checkUpdates: true,
    explorerMenu: true,
  },
  profiles: [],
};
