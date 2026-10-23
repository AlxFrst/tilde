import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Mirrors `UserTheme` in crates/tilde-config/src/themes.rs; `data` is checked by the front. */
export interface UserTheme {
  id: string;
  data: unknown;
}

/** A file of `themes/` that cannot be used. */
export interface ThemeFileError {
  file: string;
  message: string;
}

/** Mirrors `ThemesSnapshot` in src-tauri/src/commands/themes.rs. */
export interface ThemesSnapshot {
  themes: UserTheme[];
  errors: ThemeFileError[];
}

export interface PickedFile {
  name: string;
  text: string;
}

export const themesList = () => invoke<ThemesSnapshot>('themes_list');
/** Rejects with a ConfigErrorDto (invalid id, too large, I/O). */
export const themesSave = (id: string, data: unknown) =>
  invoke<undefined>('themes_save', { id, data });
export const themesDelete = (id: string) => invoke<undefined>('themes_delete', { id });
/** Native file dialog; `null` when cancelled. Rejects with a message (too large, not UTF-8). */
export const themesImportPick = () => invoke<PickedFile | null>('themes_import_pick');
/** Native save dialog; `false` when cancelled. */
export const themesExport = (id: string, text: string) =>
  invoke<boolean>('themes_export', { id, text });
export const openThemesDir = () => invoke<undefined>('open_themes_dir');

export const onThemesChanged = (cb: (s: ThemesSnapshot) => void): Promise<UnlistenFn> =>
  listen<ThemesSnapshot>('themes://changed', (e) => {
    cb(e.payload);
  });
