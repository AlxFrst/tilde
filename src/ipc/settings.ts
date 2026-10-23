import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ConfigErrorDto } from './errors';
import type { Settings } from './generated/settings';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] | null;
};

export interface SettingsSnapshot {
  settings: Settings;
  readOnly: boolean;
  error: ConfigErrorDto | null;
}

export const getSettings = () => invoke<SettingsSnapshot>('settings_get');

/** Sends a JSON Merge Patch; `null` resets a key to its default. Rejects with a ConfigErrorDto. */
export const updateSettings = (patch: DeepPartial<Settings>) =>
  invoke<Settings>('settings_update', { patch });

export const onSettingsChanged = (cb: (s: Settings) => void): Promise<UnlistenFn> =>
  listen<Settings>('settings://changed', (e) => {
    cb(e.payload);
  });

export const onSettingsError = (cb: (e: ConfigErrorDto) => void): Promise<UnlistenFn> =>
  listen<ConfigErrorDto>('settings://error', (e) => {
    cb(e.payload);
  });

export const openSettingsFile = () => invoke<undefined>('open_settings_file');
export const openLogsDir = () => invoke<undefined>('open_logs_dir');
