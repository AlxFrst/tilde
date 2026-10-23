import { invoke } from '@tauri-apps/api/core';

/** The saved workspace (validated by the store), or null. */
export const loadWorkspace = () => invoke<unknown>('workspace_load');
export const saveWorkspace = (state: unknown) => invoke<undefined>('workspace_save', { state });
