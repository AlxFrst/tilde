import { launchTakeConnection, launchTakeDir, onOpenConnection, onOpenDir } from '@/ipc/launch';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { defaultProfileId, openRecent } from './actions';

function openTerminalIn(dir: string): void {
  const id = defaultProfileId();
  if (id) useWorkspace.getState().openTab(id, dir);
}

/**
 * Opens the recent `key` names, once the saved connections are loaded (a launch can come
 * before them: a saved connection is found, and placed in its space, through them).
 */
function openConnectionKey(key: string): void {
  const open = () => {
    if (!openRecent(key)) console.warn('launch: nothing to open for', key);
  };
  if (useConnections.getState().loaded) {
    open();
    return;
  }
  const off = useConnections.subscribe((s) => {
    if (!s.loaded) return;
    off();
    open();
  });
}

/**
 * Opens a terminal in the folder Tilde was started on (`tilde --open <dir>`, Explorer's
 * "Ouvrir dans Tilde"), then in each folder a later launch hands over; and the recent
 * connection Tilde was started on (`tilde --connect`, the taskbar's jump list), then each one
 * a later launch hands over. Call once the workspace is restored, from the main window.
 * Returns the cleanup.
 */
export function startLaunchHandling(): () => void {
  launchTakeDir().then(
    (dir) => {
      if (dir) openTerminalIn(dir);
    },
    () => undefined,
  );
  launchTakeConnection().then(
    (key) => {
      if (key) openConnectionKey(key);
    },
    () => undefined,
  );
  const offDir = onOpenDir(openTerminalIn);
  const offConnection = onOpenConnection(openConnectionKey);
  return () => {
    for (const off of [offDir, offConnection]) {
      void off.then((f) => {
        f();
      });
    }
  };
}
