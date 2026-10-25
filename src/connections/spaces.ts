// Spaces (« Pro », « Perso »…) group folders, connections and sessions. While the user has
// created none, everything is in one implicit space that connections.json does not list.

import { msg, t } from '@/i18n';
import type { Connection, ConnectionsFile, Space } from '@/ipc/connections';

/** The implicit space (mirrors `MAIN_SPACE_ID` and `MAIN_SPACE_NAME` in crates/tilde-config). */
export const MAIN_SPACE: Space = { id: 'main', name: msg('Principal'), color: null, icon: null };

/**
 * The name to show for a space. The main space's default name (written by Rust in
 * French) is translated while the user has not renamed it; any other name is the user's.
 */
export function spaceName(space: Pick<Space, 'id' | 'name'>): string {
  return space.id === MAIN_SPACE.id && space.name === MAIN_SPACE.name ? t(space.name) : space.name;
}

/** The spaces, in order; never empty. */
export function listSpaces(file: Pick<ConnectionsFile, 'spaces'>): Space[] {
  return file.spaces.length > 0 ? file.spaces : [MAIN_SPACE];
}

/** The space an item belongs to: its own if it exists, else the first one. */
export function spaceIdOf(item: { spaceId: string | null }, spaces: Space[]): string {
  const first = spaces[0]?.id ?? MAIN_SPACE.id;
  return item.spaceId && spaces.some((s) => s.id === item.spaceId) ? item.spaceId : first;
}

/** A connection's space: its folder's, when it is in a folder. */
export function connectionSpace(
  c: Pick<Connection, 'folderId' | 'spaceId'>,
  file: Pick<ConnectionsFile, 'spaces' | 'folders'>,
): string {
  const spaces = listSpaces(file);
  const folder = c.folderId ? file.folders.find((f) => f.id === c.folderId) : undefined;
  return spaceIdOf(folder ?? c, spaces);
}
