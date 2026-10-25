import { invoke } from './invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** The folder Tilde was started on (`tilde --open <dir>`), once; then `null`. */
export const launchTakeDir = () => invoke<string | null>('launch_take_dir');

/** A folder handed over by a second launch (Explorer's "Ouvrir dans Tilde"). */
export const onOpenDir = (handler: (dir: string) => void): Promise<UnlistenFn> =>
  listen<string>('launch://open-dir', (e) => {
    handler(e.payload);
  });
