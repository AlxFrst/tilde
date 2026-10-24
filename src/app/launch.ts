import { launchTakeDir, onOpenDir } from '@/ipc/launch';
import { useWorkspace } from '@/stores/workspace';
import { defaultProfileId } from './actions';

function openTerminalIn(dir: string): void {
  const id = defaultProfileId();
  if (id) useWorkspace.getState().openTab(id, dir);
}

/**
 * Opens a terminal in the folder Tilde was started on (`tilde --open <dir>`, Explorer's
 * "Ouvrir dans Tilde"), then in each folder a later launch hands over. Call once the
 * workspace is restored, from the main window. Returns the cleanup.
 */
export function startLaunchHandling(): () => void {
  launchTakeDir().then(
    (dir) => {
      if (dir) openTerminalIn(dir);
    },
    () => undefined,
  );
  const off = onOpenDir(openTerminalIn);
  return () => {
    void off.then((f) => {
      f();
    });
  };
}
