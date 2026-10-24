// What the user does with spaces: switch, move a session, delete.

import { connectionSpace, listSpaces } from '@/connections/spaces';
import type { Space } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { isPinnedTab, knownSpaceIds } from '@/workspace/spaces';
import { confirmAction } from '../confirm';

const spaces = () => listSpaces(useConnections.getState().file);

// The spaces this window shows (the Quake console has only one).

/** Shows the n-th space (0-based), if there is one. */
export function switchSpaceAt(index: number): void {
  const space = knownSpaceIds()[index];
  if (space) useWorkspace.getState().switchSpace(space);
}

/** Shows the next (1) or previous (-1) space, wrapping around. */
export function switchSpaceRelative(delta: 1 | -1): void {
  const list = knownSpaceIds();
  const index = list.indexOf(useWorkspace.getState().activeSpaceId);
  const next = list[(index + delta + list.length) % list.length];
  if (next) useWorkspace.getState().switchSpace(next);
}

/**
 * Moves a session to another space. A pinned session moves with its connection (saved,
 * leaving a folder of the old space); any other session moves alone.
 */
export async function moveSessionToSpace(tabId: string, spaceId: string): Promise<void> {
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const { file, save } = useConnections.getState();
  const c = isPinnedTab(tab)
    ? file.connections.find((x) => x.id === tab.pinnedConnectionId)
    : undefined;
  if (c) await save({ ...c, spaceId });
  else useWorkspace.getState().moveTabToSpace(tabId, spaceId);
}

/**
 * Deletes a space after saying what moves where. Its connections and sessions join the
 * first remaining space; nothing is closed.
 */
export async function deleteSpace(space: Space): Promise<void> {
  const { file, removeSpace } = useConnections.getState();
  const first = spaces().find((s) => s.id !== space.id);
  if (!first) return;
  const connections = file.connections.filter((c) => connectionSpace(c, file) === space.id).length;
  const sessions = useWorkspace.getState().spaceTabs(space.id).length;
  const count = (n: number, word: string) => `${String(n)} ${word}${n > 1 ? 's' : ''}`;
  const ok = await confirmAction({
    title: `Supprimer l’espace « ${space.name} » ?`,
    description: `${count(connections, 'connexion')} et ${count(sessions, 'session')} passeront dans « ${first.name} ». Rien n’est fermé.`,
    confirmLabel: 'Supprimer',
    destructive: true,
  });
  if (ok) await removeSpace(space.id);
}
