import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from './invoke';
import type { Appearance } from './generated/settings';

export type WindowEffect = Appearance['window']['effect'];
/** Mirrors `AppliedEffect` in src-tauri/src/window_effects.rs. */
export type AppliedEffect = 'none' | 'mica' | 'acrylic' | 'vibrancy';

/** Applies `appearance.window.effect` to this window; resolves to what is shown. */
export const windowApplyEffects = (dark: boolean) =>
  invoke<AppliedEffect>('window_apply_effects', { dark });
/** The effects this system shows as asked. */
export const windowSupportedEffects = () => invoke<WindowEffect[]>('window_supported_effects');
/** Why the Quake shortcut is not active although enabled (taken, invalid), if it is not. */
export const quakeStatus = () => invoke<string | null>('quake_status');
/**
 * The Quake shortcut could not be set (taken, invalid). Rust tells the Tilde window last
 * used: listened to on this window only, or every window would say it.
 */
export const onQuakeError = (handler: (message: string) => void): Promise<UnlistenFn> =>
  listen<string>(
    'quake://error',
    (e) => {
      handler(e.payload);
    },
    { target: getCurrentWindow().label },
  );
/** Opens a new Tilde window beside this one. */
export const windowNew = () => invoke<undefined>('window_new');
/** The user confirmed closing this window (Rust forgets it once gone, unless it was the last). */
export const windowClosing = () => invoke<undefined>('window_closing');
