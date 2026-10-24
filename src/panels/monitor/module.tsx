import { Activity } from 'lucide-react';
import type { PanelModule } from '@/panels/registry';
import { useWorkspace } from '@/stores/workspace';
import { findLeaf } from '@/workspace/tree';
import type { MonitorPanel } from '@/workspace/types';
import MonitorPane from './MonitorPane';

/** « Moniteur système » : the server of the active SSH pane, otherwise this machine. */
function openMonitorForActivePane(): void {
  const ws = useWorkspace.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
  const leaf = tab ? findLeaf(tab.root, tab.activeLeafId) : null;
  if (leaf?.panel.kind === 'ssh') {
    ws.openMonitor(leaf.id, { kind: 'remote', linkedLeafId: leaf.id });
  } else {
    ws.openMonitor(null, { kind: 'local' });
  }
}

export const monitorModule: PanelModule<MonitorPanel> = {
  id: 'core.monitor',
  kind: 'monitor',
  title: 'Moniteur',
  icon: Activity,
  component: MonitorPane,
  tabTitle: (s) => (s.source.kind === 'local' ? 'Moniteur' : 'Moniteur du serveur'),
  // Kept across restarts: local as is, remote with its SSH pane (dropped without it).
  deserialize: (raw) => {
    const src = raw.source as { kind?: unknown; linkedLeafId?: unknown } | null | undefined;
    if (src?.kind === 'local') {
      return { kind: 'monitor', source: { kind: 'local' }, cwd: null, title: null };
    }
    if (src?.kind === 'remote' && typeof src.linkedLeafId === 'string') {
      return {
        kind: 'monitor',
        source: { kind: 'remote', linkedLeafId: src.linkedLeafId },
        cwd: null,
        title: null,
      };
    }
    return null;
  },
  commands: [
    {
      id: 'monitor.open',
      title: 'Moniteur système',
      keywords: ['monitor', 'stats', 'cpu', 'ram', 'disk', 'charge'],
      group: 'Panneaux',
      run: openMonitorForActivePane,
    },
  ],
};
