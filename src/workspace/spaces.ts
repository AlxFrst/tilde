// Which space a session (tab) shows in. A session pinned to a saved connection is in that
// connection's space, computed, never stored (spec §7.10-3); any other session keeps its
// own `spaceId`. The workspace store asks through a resolver so it stays independent of
// the connections store; the app installs one built from connections.json.

import { connectionSpace, listSpaces, MAIN_SPACE, spaceIdOf } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import type { Tab } from './types';

export interface SpaceResolver {
  /** The space a session shows in. */
  spaceOf: (tab: Tab) => string;
  /** Pinned to a saved connection that still exists. */
  isPinned: (tab: Tab) => boolean;
  /** The spaces' ids, in order. */
  spaceIds: () => string[];
}

/** Before connections.json is loaded: everything as written, one space. */
export const defaultSpaceResolver: SpaceResolver = {
  spaceOf: (t) => t.spaceId ?? MAIN_SPACE.id,
  isPinned: (t) => t.pinnedConnectionId !== null,
  spaceIds: () => [MAIN_SPACE.id],
};

let current = defaultSpaceResolver;

export function setSpaceResolver(r: SpaceResolver): void {
  current = r;
}

export const spaceOfTab = (tab: Tab): string => current.spaceOf(tab);
export const isPinnedTab = (tab: Tab): boolean => current.isPinned(tab);
export const knownSpaceIds = (): string[] => current.spaceIds();

export function makeSpaceResolver(file: ConnectionsFile): SpaceResolver {
  const spaces = listSpaces(file);
  const byId = new Map(file.connections.map((c) => [c.id, c]));
  const pinned = (t: Tab) => (t.pinnedConnectionId ? byId.get(t.pinnedConnectionId) : undefined);
  return {
    spaceOf: (t) => {
      const c = pinned(t);
      return c ? connectionSpace(c, file) : spaceIdOf(t, spaces);
    },
    isPinned: (t) => pinned(t) !== undefined,
    spaceIds: () => spaces.map((s) => s.id),
  };
}
