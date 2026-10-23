import { invoke } from '@tauri-apps/api/core';
import type { Appearance } from './generated/settings';

export type WindowEffect = Appearance['window']['effect'];
/** Mirrors `AppliedEffect` in src-tauri/src/window_effects.rs. */
export type AppliedEffect = 'none' | 'mica' | 'acrylic' | 'vibrancy';

/** Applies `appearance.window.effect` to this window; resolves to what is shown. */
export const windowApplyEffects = (dark: boolean) =>
  invoke<AppliedEffect>('window_apply_effects', { dark });
/** The effects this system shows as asked. */
export const windowSupportedEffects = () => invoke<WindowEffect[]>('window_supported_effects');
