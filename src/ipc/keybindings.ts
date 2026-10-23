import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ConfigErrorDto } from './errors';

export type { KeybindingsFile } from './generated/keybindings';

/** Mirrors `KeybindingsSnapshot` in src-tauri/src/commands/keybindings.rs. */
export interface KeybindingsSnapshot {
  /** Overrides only: a shortcut replaces the default, `null` unbinds the command. */
  bindings: Record<string, string | null>;
  readOnly: boolean;
  error: ConfigErrorDto | null;
  /** Entries of the file that were dropped, one sentence each. */
  warnings: string[];
}

export const keybindingsGet = () => invoke<KeybindingsSnapshot>('keybindings_get');
/** `null` leaves the command without a shortcut. Rejects with a ConfigErrorDto. */
export const keybindingsSet = (command: string, binding: string | null) =>
  invoke<undefined>('keybindings_set', { command, binding });
/** Back to the default for `command`, or for every command without one. */
export const keybindingsReset = (command?: string) =>
  invoke<undefined>('keybindings_reset', { command: command ?? null });
export const openKeybindingsFile = () => invoke<undefined>('open_keybindings_file');

export const onKeybindingsChanged = (cb: (s: KeybindingsSnapshot) => void): Promise<UnlistenFn> =>
  listen<KeybindingsSnapshot>('keybindings://changed', (e) => {
    cb(e.payload);
  });
export const onKeybindingsError = (cb: (e: ConfigErrorDto) => void): Promise<UnlistenFn> =>
  listen<ConfigErrorDto>('keybindings://error', (e) => {
    cb(e.payload);
  });
