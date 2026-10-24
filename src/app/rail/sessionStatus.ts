import type { ConnState } from '@/ipc/ssh';
import { useSsh } from '@/stores/ssh';
import { leaves } from '@/workspace/tree';
import type { Tab } from '@/workspace/types';

/** The connection state of a session's (first) SSH pane; none for a local session. */
export function useSessionStatus(tab: Tab | undefined): ConnState | undefined {
  const leafId = tab ? leaves(tab.root).find((l) => l.panel.kind === 'ssh')?.id : undefined;
  return useSsh((s) => (leafId ? s.states[leafId] : undefined));
}
