// How sessions and their panes are named, in the Rail and in the pane headers.

import { Activity, FolderTree, Terminal, type LucideIcon } from 'lucide-react';
import { useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { getPanelModule } from '@/panels/registry';
import { findLeaf, leaves } from '@/workspace/tree';
import type { LeafNode, Tab } from '@/workspace/types';

export interface LabelNames {
  /** A saved connection's name. */
  connectionName: (id: string | null) => string | null;
  /** A shell profile's name. */
  profileName: (id: string) => string | null;
}

export interface PaneLabel {
  title: string;
  /** The connection a pane belongs to (files, monitor): « Fichiers · demo-server ». */
  owner: string | null;
  /** What the pane is on: a directory, a path. */
  detail: string | null;
  Icon: LucideIcon;
}

const isShell = (l: LeafNode) => l.panel.kind === 'terminal' || l.panel.kind === 'ssh';

/** The name of the SSH pane `leafId` connects to. */
function hostName(tab: Tab, leafId: string, names: LabelNames): string | null {
  const ssh = findLeaf(tab.root, leafId)?.panel;
  if (ssh?.kind !== 'ssh') return null;
  return names.connectionName(ssh.connectionId) ?? ssh.target;
}

export function paneLabel(tab: Tab, leaf: LeafNode, names: LabelNames): PaneLabel {
  const { panel } = leaf;
  switch (panel.kind) {
    case 'terminal':
    case 'ssh': {
      const shells = leaves(tab.root).filter(isShell);
      const rank = shells.findIndex((l) => l.id === leaf.id) + 1;
      return {
        title: shells.length > 1 ? `Shell ${String(rank)}` : 'Shell',
        owner: null,
        // The session's row already names the host or the shell.
        detail: panel.cwd,
        Icon: Terminal,
      };
    }
    case 'sftp':
      return {
        title: 'Fichiers',
        owner: hostName(tab, panel.linkedLeafId, names),
        detail: panel.path,
        Icon: FolderTree,
      };
    case 'monitor':
      return {
        title: 'Moniteur',
        owner:
          panel.source.kind === 'remote'
            ? hostName(tab, panel.source.linkedLeafId, names)
            : 'cette machine',
        detail: null,
        Icon: Activity,
      };
    default: {
      const module = getPanelModule(panel.kind);
      return {
        title: module?.tabTitle?.(panel) ?? module?.title ?? panel.kind,
        owner: null,
        detail: null,
        Icon: module?.icon ?? Terminal,
      };
    }
  }
}

/** A session's name: the one given, else its connection, else its shell. */
export function sessionTitle(tab: Tab, names: LabelNames): string {
  if (tab.customTitle) return tab.customTitle;
  const all = leaves(tab.root);
  const ssh = all.find((l) => l.panel.kind === 'ssh')?.panel;
  if (ssh?.kind === 'ssh') return names.connectionName(ssh.connectionId) ?? ssh.title ?? ssh.target;
  const term = all.find((l) => l.panel.kind === 'terminal')?.panel;
  if (term?.kind === 'terminal') {
    // The shell's own title (« Administrateur : C:\WINDOWS… ») is noise in the Rail.
    return names.profileName(term.profileId) ?? term.title ?? term.profileId;
  }
  const first = all[0];
  return first ? paneLabel(tab, first, names).title : '';
}

/** Names from the connections and profiles stores, re-rendering when they change. */
export function useLabelNames(): LabelNames {
  const connections = useConnections((s) => s.file.connections);
  const profiles = useProfiles((s) => s.profiles);
  return {
    connectionName: (id) => (id ? (connections.find((c) => c.id === id)?.name ?? null) : null),
    profileName: (id) => profiles.find((p) => p.id === id)?.name ?? null,
  };
}
