import { invoke } from './invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The folder Tilde was started on (`tilde --open <dir>`), once; then `null`. */
export const launchTakeDir = () => invoke<string | null>('launch_take_dir');

/**
 * The recent connection Tilde was started on (`tilde --connect`, the taskbar's jump list),
 * once: its key (`conn:<id>`, `ssh:<target>`), already checked by Rust; then `null`.
 */
export const launchTakeConnection = () => invoke<string | null>('launch_take_connection');

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

/**
 * A recent connection handed over by a later launch (the taskbar's jump list): its key,
 * already checked by Rust. To one window, like `onOpenDir`.
 */
export const onOpenConnection = (handler: (key: string) => void): Promise<UnlistenFn> =>
  listen<string>(
    'launch://open-connection',
    (e) => {
      handler(e.payload);
    },
    { target: getCurrentWindow().label },
  );
