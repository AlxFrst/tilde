import { toast } from 'sonner';
import type { Settings } from '@/ipc/generated/settings';
import { pickDefaultProfile, type ResolvedProfile } from '@/ipc/profiles';
import { loadWorkspace, saveWorkspace } from '@/ipc/workspace';
import { useWorkspace } from '@/stores/workspace';
import type { WorkspaceSnapshot } from './types';

const SAVE_DELAY_MS = 500;
const noop = () => undefined;

let flushPending: (() => void) | null = null;

/** Saves the workspace 500 ms after the last change. Returns an unsubscribe function. */
export function startPersistence(delayMs = SAVE_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    flushPending = null;
    saveWorkspace(useWorkspace.getState().snapshot()).catch((err: unknown) => {
      console.warn('workspace not saved', err);
    });
  };
  const unsubscribe = useWorkspace.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, delayMs);
    flushPending = save;
  });
  return () => {
    clearTimeout(timer);
    flushPending = null;
    unsubscribe();
  };
}

/** Writes any pending change now (window closing). */
export function flushWorkspace(): void {
  flushPending?.();
}

/**
 * Restores the previous tabs (if enabled and available) or opens one default tab.
 * Panes whose profile no longer exists are relaunched with the default profile.
 * Shells restart in their last known directory; scrollback is not restored.
 */
export async function restoreWorkspace(
  profiles: ResolvedProfile[],
  settings: Settings,
): Promise<void> {
  const fallback = pickDefaultProfile(profiles, settings.terminal.defaultProfile);
  if (!fallback) return; // no shell at all: the welcome screen explains it
  const ws = useWorkspace.getState();
  if (settings.general.restoreSession) {
    const snapshot = await loadWorkspace().catch(noop);
    const { replaced } = ws.hydrate(
      snapshot as WorkspaceSnapshot,
      profiles.map((p) => p.id),
      fallback.id,
    );
    if (useWorkspace.getState().tabs.length > 0) {
      if (replaced > 0) {
        toast.info(
          `${String(replaced)} panneau(x) relancé(s) avec « ${fallback.name} » : leur profil n’existe plus.`,
        );
      }
      return;
    }
  }
  ws.openTab(fallback.id);
}
