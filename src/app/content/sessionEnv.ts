import type { ConnectionsFile } from '@/ipc/connections';
import { findLeaf } from '@/workspace/tree';
import { describeTarget } from '../sidebar/Section';
import type { Tab } from '@/workspace/types';

/** The SSH pane the active pane is, or belongs to (files, server monitor). */
export function activeSshLeafId(tab: Tab): string | null {
  const panel = findLeaf(tab.root, tab.activeLeafId)?.panel;
  if (panel?.kind === 'ssh') return tab.activeLeafId;
  if (panel?.kind === 'sftp') return panel.linkedLeafId;
  if (panel?.kind === 'monitor' && panel.source.kind === 'remote') {
    return panel.source.linkedLeafId;
  }
  return null;
}

/**
 * Where the active pane is connected (`user@host:port` of its saved connection, else the
 * SSH target), or `null` for a local pane.
 */
export function sessionWhere(tab: Tab, file: Pick<ConnectionsFile, 'connections'>): string | null {
  const leafId = activeSshLeafId(tab);
  const ssh = leafId ? findLeaf(tab.root, leafId)?.panel : undefined;
  if (ssh?.kind !== 'ssh') return null;
  const saved = ssh.connectionId
    ? file.connections.find((c) => c.id === ssh.connectionId)
    : undefined;
  return saved ? describeTarget(saved) : ssh.target;
}

/**
 * The environment the active pane is in: the coloured folder of its saved connection
 * (« PROD » in red). A safety signal, so it follows the pane the user types in.
 */
export function sessionEnv(
  tab: Tab,
  file: Pick<ConnectionsFile, 'connections' | 'folders'>,
): { label: string; color: string } | null {
  const leafId = activeSshLeafId(tab);
  const ssh = leafId ? findLeaf(tab.root, leafId)?.panel : undefined;
  if (ssh?.kind !== 'ssh' || !ssh.connectionId) return null;
  const c = file.connections.find((x) => x.id === ssh.connectionId);
  const folder = c?.folderId ? file.folders.find((f) => f.id === c.folderId) : undefined;
  return folder?.color ? { label: folder.name.toUpperCase(), color: folder.color } : null;
}
