// User-level actions shared by the tab bar, shortcuts and menus.

import type { Connection } from '@/ipc/connections';
import { pickDefaultProfile } from '@/ipc/profiles';
import { dirtyEditors } from '@/stores/editors';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { sessionsFor } from '@/terminal/sessionRegistry';
import { leaves } from '@/workspace/tree';
import { confirmClose } from './closeGuard';

export function defaultProfileId(): string | null {
  const wanted = useSettings.getState().settings?.terminal.defaultProfile ?? null;
  return pickDefaultProfile(useProfiles.getState().profiles, wanted)?.id ?? null;
}

export function openDefaultTab(): void {
  const id = defaultProfileId();
  if (id) useWorkspace.getState().openTab(id);
}

/** Opens a saved connection in a new tab. */
export function openConnection(c: Connection): void {
  useWorkspace.getState().openSshTab(c.host, c.id);
}

/**
 * Files with unsaved changes that closing these panes would lose: editors among them,
 * and remote editors that depend on one of them (their SSH pane).
 */
export function unsavedIn(leafIds: readonly string[]): string[] {
  const closing = new Set(leafIds);
  const linked = useWorkspace
    .getState()
    .tabs.flatMap((t) => leaves(t.root))
    .filter(
      (l) =>
        l.panel.kind === 'editor' &&
        l.panel.source.kind === 'remote' &&
        closing.has(l.panel.source.linkedLeafId),
    )
    .map((l) => l.id);
  return dirtyEditors([...new Set([...leafIds, ...linked])]);
}

export async function closePane(tabId: string, leafId: string): Promise<void> {
  if (await confirmClose(sessionsFor([leafId]), unsavedIn([leafId]))) {
    useWorkspace.getState().closeLeaf(tabId, leafId);
  }
}

export async function closeTab(tabId: string): Promise<void> {
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const leafIds = leaves(tab.root).map((l) => l.id);
  if (await confirmClose(sessionsFor(leafIds), unsavedIn(leafIds))) {
    useWorkspace.getState().closeTab(tabId);
  }
}

export function closeActivePane(): Promise<void> {
  const { tabs, activeTabId } = useWorkspace.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab ? closePane(tab.id, tab.activeLeafId) : Promise.resolve();
}
