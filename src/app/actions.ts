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

export async function closePane(tabId: string, leafId: string): Promise<void> {
  if (await confirmClose(sessionsFor([leafId]), dirtyEditors([leafId]))) {
    useWorkspace.getState().closeLeaf(tabId, leafId);
  }
}

export async function closeTab(tabId: string): Promise<void> {
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const leafIds = leaves(tab.root).map((l) => l.id);
  if (await confirmClose(sessionsFor(leafIds), dirtyEditors(leafIds))) {
    useWorkspace.getState().closeTab(tabId);
  }
}

export function closeActivePane(): Promise<void> {
  const { tabs, activeTabId } = useWorkspace.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab ? closePane(tab.id, tab.activeLeafId) : Promise.resolve();
}
