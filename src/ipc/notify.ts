// System notifications and window attention, for sessions out of sight. Wrapped here so
// tests mock one module, and so a window without them (tests, a missing permission)
// simply goes without: none of this may break a terminal.

import { UserAttentionType, getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

const noop = () => undefined;

let permission: Promise<boolean> | null = null;

/** Whether the system lets Tilde notify; asked once per window, at the first notification. */
function allowed(): Promise<boolean> {
  permission ??= (async () => {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  })().catch(() => false);
  return permission;
}

/** A system notification. Clicking it does nothing: the plugin cannot tell us. */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!(await allowed())) return;
  try {
    sendNotification({ title, body });
  } catch {
    // No notification system: the Rail badge still says it.
  }
}

/** Flashes this window in the taskbar (the dock on macOS) until it gets the focus. */
export function requestAttention(): void {
  try {
    getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(noop);
  } catch {
    // No Tauri window (tests).
  }
}

/**
 * Calls `cb` when this window gains or loses the focus; returns the function that stops.
 * A focus event of the page itself also counts: the user is in the window.
 */
export function onWindowFocus(cb: (focused: boolean) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  const onPageFocus = () => {
    cb(true);
  };
  window.addEventListener('focus', onPageFocus);
  try {
    getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        cb(payload);
      })
      .then((off) => {
        if (stopped) off();
        else stop = off;
      }, noop);
  } catch {
    // No Tauri window (tests): the page's own focus events are all there is.
  }
  return () => {
    stopped = true;
    window.removeEventListener('focus', onPageFocus);
    stop?.();
  };
}

/** Whether this window has the focus now. */
export function windowHasFocus(): boolean {
  return typeof document === 'undefined' || document.hasFocus();
}
