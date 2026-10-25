import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { tRust } from '@/i18n/rust';

/** The error a command rejects with, its French message in the interface's language. */
function localize(error: unknown): unknown {
  if (typeof error === 'string') return tRust(error);
  if (error instanceof Error) {
    error.message = tRust(error.message);
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') return { ...error, message: tRust(message) };
  }
  return error;
}

/** Tauri's `invoke`, with the same arguments. Every typed wrapper in src/ipc uses it. */
export function invoke<T>(...call: Parameters<typeof tauriInvoke>): Promise<T> {
  // Commands reject with their error value (a DTO or a string), not an Error.
  const fail = (error: unknown) => {
    throw localize(error);
  };
  try {
    return Promise.resolve(tauriInvoke<T>(...call)).catch(fail);
  } catch (error) {
    return Promise.resolve().then(() => fail(error));
  }
}
