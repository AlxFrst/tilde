import { invoke } from './invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Mirrors `UpdateInfo` in src-tauri/src/updater.rs. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** The newer version on GitHub, or `null`. Rejects with a message (network…). */
export const updateCheck = () => invoke<UpdateInfo | null>('update_check');
/** Downloads, verifies the signature, installs and restarts Tilde. */
export const updateInstall = () => invoke<undefined>('update_install');

export const onUpdateProgress = (cb: (p: UpdateProgress) => void): Promise<UnlistenFn> =>
  listen<UpdateProgress>('update://progress', (e) => {
    cb(e.payload);
  });
