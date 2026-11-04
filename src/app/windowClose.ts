import { windowClosing } from '@/ipc/window';
import { dirtyEditors } from '@/stores/editors';
import { allSessions } from '@/terminal/sessionRegistry';
import { flushWorkspace } from '@/workspace/persistence';
import { confirmClose } from './closeGuard';

/**
 * The window is asked to close: asks first while a program runs in one of its terminals
 * (or a file is unsaved). Once confirmed, its workspace is saved and Rust learns that the
 * user closed it: gone while other windows stay open, it is forgotten; the last one is
 * opened again at the next start.
 */
export async function onCloseRequested(event: { preventDefault: () => void }): Promise<void> {
  if (!(await confirmClose(allSessions(), dirtyEditors()))) {
    event.preventDefault();
    return;
  }
  flushWorkspace();
  await windowClosing().catch(() => undefined);
}
