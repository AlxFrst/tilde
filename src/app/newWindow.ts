import { windowNew } from '@/ipc/window';
import { useWorkspace } from '@/stores/workspace';

/**
 * *Nouvelle fenêtre*: another Tilde window, on the space this one shows (with that space's
 * servers, asleep; the sessions running here stay here).
 */
export function openNewWindow(): void {
  windowNew(useWorkspace.getState().activeSpaceId).catch((err: unknown) => {
    console.warn('new window failed', err);
  });
}
