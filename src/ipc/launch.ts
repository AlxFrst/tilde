import { invoke } from './invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The folder Tilde was started on (`tilde --open <dir>`), once; then `null`. */
export const launchTakeDir = () => invoke<string | null>('launch_take_dir');

/**
 * A folder handed over by a later launch (Explorer's "Ouvrir dans Tilde"). Rust hands it to
 * one window (the last used): listened to on this window only, not every window's.
 */
export const onOpenDir = (handler: (dir: string) => void): Promise<UnlistenFn> =>
  listen<string>(
    'launch://open-dir',
    (e) => {
      handler(e.payload);
    },
    { target: getCurrentWindow().label },
  );
