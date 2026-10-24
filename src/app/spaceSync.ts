import { listSpaces } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';

function apply(file: ConnectionsFile): void {
  setSpaceResolver(makeSpaceResolver(file));
  useWorkspace.getState().reconcileSpaces(listSpaces(file).map((s) => s.id));
}

/**
 * Keeps the sessions' spaces in step with connections.json: a pinned session follows its
 * connection, and a deleted space hands over to the first one. Returns the cleanup.
 */
export function startSpaceSync(): () => void {
  apply(useConnections.getState().file);
  return useConnections.subscribe((state, previous) => {
    if (state.file !== previous.file) apply(state.file);
  });
}
