import { listSpaces, MAIN_SPACE } from '@/connections/spaces';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import {
  defaultSpaceResolver,
  makeSpaceResolver,
  setSpaceResolver,
  singleSpaceResolver,
} from '@/workspace/spaces';

function apply(): void {
  const { file, loaded } = useConnections.getState();
  setSpaceResolver(makeSpaceResolver(file, loaded));
  useWorkspace.getState().reconcileSpaces(listSpaces(file).map((s) => s.id));
}

/**
 * Keeps the sessions' spaces in step with connections.json: a pinned session follows its
 * connection, and a deleted space hands over to the first one. Returns the cleanup.
 */
export function startSpaceSync(): () => void {
  apply();
  return useConnections.subscribe((state, previous) => {
    if (state.file !== previous.file || state.loaded !== previous.loaded) apply();
  });
}

/** The Quake console: every session in one list, whatever its space. Returns the cleanup. */
export function startSingleSpace(): () => void {
  setSpaceResolver(singleSpaceResolver);
  useWorkspace.getState().switchSpace(MAIN_SPACE.id);
  return () => {
    setSpaceResolver(defaultSpaceResolver);
  };
}
