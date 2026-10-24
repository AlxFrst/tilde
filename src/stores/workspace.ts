import { sameSource, samePreviewSource } from '@/panels/editor/fileName';
import { serializeSnapshot } from '@/workspace/serialize';
import { create } from 'zustand';
import {
  findLeaf,
  leaves,
  neighbor,
  removeLeaf,
  setSizes as setTreeSizes,
  splitLeaf,
  updatePanel as updateTreePanel,
} from '@/workspace/tree';
import type {
  Direction,
  FileSource,
  MonitorPanel,
  PreviewSource,
  FocusDirection,
  LayoutNode,
  LeafNode,
  PanelPatch,
  Tab,
  WorkspaceSnapshot,
} from '@/workspace/types';
import { sanitizeSnapshot } from '@/workspace/sanitize';
import { isPinnedTab, spaceOfTab } from '@/workspace/spaces';
import { MAIN_SPACE } from '@/connections/spaces';

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (profileId: string, cwd?: string | null) => string;
  /** `target`: an alias of ~/.ssh/config or `user@host:port`. */
  openSshTab: (target: string, connectionId?: string | null) => string;
  /** Opens the files (SFTP) of an SSH pane to its right; focuses it if already open. */
  openSftpBeside: (sshLeafId: string) => void;
  /** Opens a file in the built-in editor beside a pane (new tab if `null`), or focuses it. */
  openEditor: (besideLeafId: string | null, source: FileSource) => void;
  /** Opens a preview beside a pane, or focuses one already showing the same thing. */
  openPreview: (besideLeafId: string, source: PreviewSource) => void;
  /** Opens a system monitor beside a pane (new tab if `null`), or focuses the same one. */
  openMonitor: (besideLeafId: string | null, source: MonitorPanel['source']) => void;
  /** Shows the files of an SSH pane, or closes them if they are open. */
  toggleSftp: (sshLeafId: string) => void;
  /** Shows the server monitor of an SSH pane, or closes it if it is open. */
  toggleRemoteMonitor: (sshLeafId: string) => void;
  closeTab: (tabId: string) => void;
  /** Shows a session, switching to its space. */
  activateTab: (tabId: string) => void;
  /** The space shown in the Rail; new sessions open in it. */
  activeSpaceId: string;
  /** The session last shown in each space (restored when switching back). */
  activeTabBySpace: Record<string, string>;
  switchSpace: (spaceId: string) => void;
  /** The sessions of a space, in order. */
  spaceTabs: (spaceId: string) => Tab[];
  /** Shows the session pinned to a saved connection, or opens it (in `spaceId`). */
  openPinned: (connectionId: string, target: string, spaceId: string) => string;
  /** Makes a session the pinned one of a connection (unpinning any other). */
  pinTab: (tabId: string, connectionId: string) => void;
  /** Sends a pinned session to « Aujourd'hui », in the space it is in. */
  unpinTab: (tabId: string) => void;
  /** Moves a session (unpinned) to another space; the current space stays shown. */
  moveTabToSpace: (tabId: string, spaceId: string) => void;
  /** The other sessions of the same space. */
  otherTabs: (tabId: string) => string[];
  /** The sessions after this one in « Aujourd'hui » (none for a pinned session). */
  tabsAfter: (tabId: string) => string[];
  /** After spaces change: an unknown active space falls back to the first. */
  reconcileSpaces: (known: string[]) => void;
  activateRelative: (delta: 1 | -1) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  renameTab: (tabId: string, title: string | null) => void;
  setTabColor: (tabId: string, color: string | null) => void;
  splitActive: (direction: Direction, profileId?: string) => void;
  /** A new SSH pane to `target` beside the shown session's active pane (or a new session). */
  splitWithSsh: (target: string, connectionId: string | null, direction?: Direction) => void;
  /** A new shell on the host of SSH pane `sshLeafId`, beside its session's active pane. */
  addShellBeside: (sshLeafId: string, direction?: Direction) => void;
  closeLeaf: (tabId: string, leafId: string) => void;
  focusLeaf: (tabId: string, leafId: string) => void;
  focusNeighbor: (dir: FocusDirection) => void;
  updatePanel: (tabId: string, leafId: string, patch: PanelPatch) => void;
  setSizes: (tabId: string, splitId: string, sizes: number[]) => void;
  /** Restored SSH panes, left disconnected until the user asks (not persisted). */
  dormant: string[];
  wake: (leafId: string) => void;
  snapshot: () => WorkspaceSnapshot;
  hydrate: (
    s: WorkspaceSnapshot,
    availableProfileIds: string[],
    fallbackProfileId: string,
  ) => { replaced: number };
}

const newLeaf = (profileId: string, cwd: string | null = null): LeafNode => ({
  type: 'leaf',
  id: crypto.randomUUID(),
  panel: { kind: 'terminal', profileId, cwd, title: null },
});

const newSshLeaf = (target: string, connectionId: string | null = null): LeafNode => ({
  type: 'leaf',
  id: crypto.randomUUID(),
  panel: { kind: 'ssh', target, connectionId, cwd: null, title: null },
});

/** `record` without `key`. */
const without = (record: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** Index of the tab to activate after removing the one at `index`. */
const neighborIndex = (index: number, remaining: number) => Math.min(index, remaining - 1);

/** The files or the server monitor attached to an SSH pane, in whichever tab they are. */
export function findLinked(
  tabs: readonly Tab[],
  sshLeafId: string,
  kind: 'sftp' | 'monitor',
): { tabId: string; leafId: string } | null {
  for (const t of tabs) {
    const leaf = leaves(t.root).find(({ panel: p }) =>
      p.kind === 'sftp'
        ? kind === 'sftp' && p.linkedLeafId === sshLeafId
        : p.kind === 'monitor' &&
          kind === 'monitor' &&
          p.source.kind === 'remote' &&
          p.source.linkedLeafId === sshLeafId,
    );
    if (leaf) return { tabId: t.id, leafId: leaf.id };
  }
  return null;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  const mapTab = (tabId: string, f: (t: Tab) => Tab) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? f(t) : t)) }));
  };
  const activeTab = () => get().tabs.find((t) => t.id === get().activeTabId);
  const spaceTabsOf = (spaceId: string) => get().tabs.filter((t) => spaceOfTab(t) === spaceId);
  /** Shows a session and its space, remembering it as that space's last one. */
  const activate = (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const space = spaceOfTab(tab);
    set((s) => ({
      activeTabId: tab.id,
      activeSpaceId: space,
      activeTabBySpace: { ...s.activeTabBySpace, [space]: tab.id },
    }));
  };
  /** The neighbour to show when `tabId` leaves its space's list. */
  const neighbourOf = (tabId: string, spaceId: string): Tab | null => {
    const siblings = spaceTabsOf(spaceId);
    const index = siblings.findIndex((t) => t.id === tabId);
    const rest = siblings.filter((t) => t.id !== tabId);
    return rest[neighborIndex(Math.max(0, index), rest.length)] ?? null;
  };
  /** Puts the focus back on a pane after closing something attached to it. */
  const refocus = (leafId: string) => {
    const tab = get().tabs.find((t) => findLeaf(t.root, leafId));
    if (!tab) return;
    activate(tab.id);
    get().focusLeaf(tab.id, leafId);
  };
  const addTab = (
    leaf: LeafNode,
    place: { spaceId?: string; pinnedConnectionId?: string } = {},
  ) => {
    const tab: Tab = {
      id: crypto.randomUUID(),
      customTitle: null,
      color: null,
      root: leaf,
      activeLeafId: leaf.id,
      spaceId: place.spaceId ?? get().activeSpaceId,
      pinnedConnectionId: place.pinnedConnectionId ?? null,
    };
    set((s) => ({ tabs: [...s.tabs, tab] }));
    activate(tab.id);
    return tab.id;
  };

  const removeTab = (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const space = spaceOfTab(tab);
    const next = get().activeTabId === tabId ? neighbourOf(tabId, space) : undefined;
    set((s) => {
      const bySpace =
        s.activeTabBySpace[space] === tabId
          ? without(s.activeTabBySpace, space)
          : s.activeTabBySpace;
      return {
        tabs: s.tabs.filter((t) => t.id !== tabId),
        activeTabId: next === undefined ? s.activeTabId : (next?.id ?? null),
        activeTabBySpace: next ? { ...bySpace, [space]: next.id } : bySpace,
      };
    });
  };

  /** Closes one pane (and its tab if it was the last), nothing else. */
  const removePane = (tabId: string, leafId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const before = leaves(tab.root);
    const root = removeLeaf(tab.root, leafId);
    if (!root) {
      removeTab(tabId);
      return;
    }
    // Focus the pane that took the closed one's place (the previous one, else the next).
    const index = before.findIndex((l) => l.id === leafId);
    const after = leaves(root);
    const activeLeafId =
      tab.activeLeafId !== leafId
        ? tab.activeLeafId
        : ((after[Math.max(0, index - 1)] ?? after[0])?.id ?? '');
    mapTab(tabId, (t) => ({ ...t, root, activeLeafId }));
  };

  // Files and server monitors belong to an SSH pane: they go when it goes.
  const closeOrphans = () => {
    for (;;) {
      const { tabs } = get();
      const ssh = new Set(
        tabs.flatMap((t) =>
          leaves(t.root)
            .filter((l) => l.panel.kind === 'ssh')
            .map((l) => l.id),
        ),
      );
      let orphan: { tabId: string; leafId: string } | null = null;
      for (const t of tabs) {
        const l = leaves(t.root).find(({ panel: p }) => {
          const linked =
            p.kind === 'sftp'
              ? p.linkedLeafId
              : p.kind === 'monitor' && p.source.kind === 'remote'
                ? p.source.linkedLeafId
                : null;
          return linked !== null && !ssh.has(linked);
        });
        if (l) {
          orphan = { tabId: t.id, leafId: l.id };
          break;
        }
      }
      if (!orphan) return;
      removePane(orphan.tabId, orphan.leafId);
    }
  };

  return {
    tabs: [],
    activeTabId: null,
    dormant: [],

    openTab: (profileId, cwd = null) => addTab(newLeaf(profileId, cwd)),

    openSshTab: (target, connectionId = null) => addTab(newSshLeaf(target, connectionId)),

    openEditor: (besideLeafId, source) => {
      const { tabs } = get();
      for (const t of tabs) {
        const open = leaves(t.root).find(
          (l) => l.panel.kind === 'editor' && sameSource(l.panel.source, source),
        );
        if (open) {
          activate(t.id);
          get().focusLeaf(t.id, open.id);
          return;
        }
      }
      const leaf: LeafNode = {
        type: 'leaf',
        id: crypto.randomUUID(),
        panel: { kind: 'editor', source, cwd: null, title: null },
      };
      const tab = besideLeafId ? tabs.find((t) => findLeaf(t.root, besideLeafId)) : undefined;
      if (!tab || !besideLeafId) {
        addTab(leaf);
        return;
      }
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, besideLeafId, 'row', leaf),
        activeLeafId: leaf.id,
      }));
      activate(tab.id);
    },

    openPreview: (besideLeafId, source) => {
      const { tabs } = get();
      for (const t of tabs) {
        const open = leaves(t.root).find(
          (l) => l.panel.kind === 'preview' && samePreviewSource(l.panel.source, source),
        );
        if (open) {
          activate(t.id);
          get().focusLeaf(t.id, open.id);
          return;
        }
      }
      const leaf: LeafNode = {
        type: 'leaf',
        id: crypto.randomUUID(),
        panel: { kind: 'preview', source, cwd: null, title: null },
      };
      const tab = tabs.find((t) => findLeaf(t.root, besideLeafId));
      if (!tab) {
        addTab(leaf);
        return;
      }
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, besideLeafId, 'row', leaf),
        activeLeafId: leaf.id,
      }));
      activate(tab.id);
    },

    openMonitor: (besideLeafId, source) => {
      const { tabs } = get();
      for (const t of tabs) {
        const open = leaves(t.root).find(
          (l) =>
            l.panel.kind === 'monitor' &&
            l.panel.source.kind === source.kind &&
            (source.kind === 'local' ||
              (l.panel.source.kind === 'remote' &&
                l.panel.source.linkedLeafId === source.linkedLeafId)),
        );
        if (open) {
          activate(t.id);
          get().focusLeaf(t.id, open.id);
          return;
        }
      }
      const leaf: LeafNode = {
        type: 'leaf',
        id: crypto.randomUUID(),
        panel: { kind: 'monitor', source, cwd: null, title: null },
      };
      const tab = besideLeafId ? tabs.find((t) => findLeaf(t.root, besideLeafId)) : undefined;
      if (!tab || !besideLeafId) {
        addTab(leaf);
        return;
      }
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, besideLeafId, 'row', leaf),
        activeLeafId: leaf.id,
      }));
      activate(tab.id);
    },

    openSftpBeside: (sshLeafId) => {
      const tab = get().tabs.find((t) => findLeaf(t.root, sshLeafId));
      if (!tab) return;
      const existing = leaves(tab.root).find(
        (l) => l.panel.kind === 'sftp' && l.panel.linkedLeafId === sshLeafId,
      );
      if (existing) {
        activate(tab.id);
        get().focusLeaf(tab.id, existing.id);
        return;
      }
      const leaf: LeafNode = {
        type: 'leaf',
        id: crypto.randomUUID(),
        panel: {
          kind: 'sftp',
          linkedLeafId: sshLeafId,
          path: null,
          follow: true,
          cwd: null,
          title: null,
        },
      };
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, sshLeafId, 'row', leaf),
        activeLeafId: leaf.id,
      }));
      activate(tab.id);
    },

    toggleSftp: (sshLeafId) => {
      const open = findLinked(get().tabs, sshLeafId, 'sftp');
      if (!open) {
        get().openSftpBeside(sshLeafId);
        return;
      }
      get().closeLeaf(open.tabId, open.leafId);
      refocus(sshLeafId);
    },

    toggleRemoteMonitor: (sshLeafId) => {
      const open = findLinked(get().tabs, sshLeafId, 'monitor');
      if (!open) {
        get().openMonitor(sshLeafId, { kind: 'remote', linkedLeafId: sshLeafId });
        return;
      }
      get().closeLeaf(open.tabId, open.leafId);
      refocus(sshLeafId);
    },

    closeTab: (tabId) => {
      removeTab(tabId);
      closeOrphans();
    },

    activateTab: (tabId) => {
      activate(tabId);
    },

    activateRelative: (delta) => {
      const { activeTabId, activeSpaceId } = get();
      const tabs = spaceTabsOf(activeSpaceId);
      if (tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === activeTabId);
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (next) activate(next.id);
    },

    activeSpaceId: MAIN_SPACE.id,
    activeTabBySpace: {},

    switchSpace: (spaceId) => {
      const tabs = spaceTabsOf(spaceId);
      const remembered = get().activeTabBySpace[spaceId];
      const next = tabs.find((t) => t.id === remembered) ?? tabs[0] ?? null;
      set((s) => ({
        activeSpaceId: spaceId,
        activeTabId: next?.id ?? null,
        activeTabBySpace: next ? { ...s.activeTabBySpace, [spaceId]: next.id } : s.activeTabBySpace,
      }));
    },

    spaceTabs: (spaceId) => spaceTabsOf(spaceId),

    openPinned: (connectionId, target, spaceId) => {
      const existing = get().tabs.find((t) => t.pinnedConnectionId === connectionId);
      if (existing) {
        activate(existing.id);
        return existing.id;
      }
      return addTab(newSshLeaf(target, connectionId), {
        spaceId,
        pinnedConnectionId: connectionId,
      });
    },

    pinTab: (tabId, connectionId) => {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id === tabId) return { ...t, pinnedConnectionId: connectionId };
          if (t.pinnedConnectionId === connectionId) {
            return { ...t, spaceId: spaceOfTab(t), pinnedConnectionId: null };
          }
          return t;
        }),
      }));
    },

    unpinTab: (tabId) => {
      mapTab(tabId, (t) => ({ ...t, spaceId: spaceOfTab(t), pinnedConnectionId: null }));
    },

    moveTabToSpace: (tabId, spaceId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const from = spaceOfTab(tab);
      const leaving = get().activeTabId === tabId && spaceId !== get().activeSpaceId;
      const next = leaving ? neighbourOf(tabId, from) : null;
      mapTab(tabId, (t) => ({ ...t, spaceId, pinnedConnectionId: null }));
      if (!leaving) return;
      set((s) => {
        const bySpace = { ...s.activeTabBySpace, [spaceId]: tabId };
        return {
          activeTabId: next?.id ?? null,
          activeTabBySpace: next ? { ...bySpace, [from]: next.id } : without(bySpace, from),
        };
      });
    },

    otherTabs: (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return [];
      return spaceTabsOf(spaceOfTab(tab))
        .filter((t) => t.id !== tabId)
        .map((t) => t.id);
    },

    tabsAfter: (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab || isPinnedTab(tab)) return [];
      const today = spaceTabsOf(spaceOfTab(tab)).filter((t) => !isPinnedTab(t));
      return today.slice(today.findIndex((t) => t.id === tabId) + 1).map((t) => t.id);
    },

    reconcileSpaces: (known) => {
      const { activeSpaceId } = get();
      if (!known.includes(activeSpaceId)) {
        get().switchSpace(known[0] ?? MAIN_SPACE.id);
        return;
      }
      // The shown session moved (its connection changed space): follow it.
      const shown = activeTab();
      if (shown && spaceOfTab(shown) !== activeSpaceId) activate(shown.id);
    },

    moveTab: (from, to) => {
      set((s) => {
        const tabs = [...s.tabs];
        const [moved] = tabs.splice(from, 1);
        if (!moved) return s;
        tabs.splice(to, 0, moved);
        return { tabs };
      });
    },

    renameTab: (tabId, title) => {
      const trimmed = title?.trim();
      mapTab(tabId, (t) => ({ ...t, customTitle: trimmed ? trimmed : null }));
    },

    setTabColor: (tabId, color) => {
      mapTab(tabId, (t) => ({ ...t, color }));
    },

    splitActive: (direction, profileId) => {
      const tab = activeTab();
      if (!tab) return;
      const current = findLeaf(tab.root, tab.activeLeafId);
      if (!current) return;
      // Splitting an SSH pane opens another shell on the same host.
      const { panel } = current;
      // Splitting a files pane opens a second view of the same session; splitting any
      // other pane (an editor…) opens a shell like the tab's first local terminal.
      const shell = leaves(tab.root).find((l) => l.panel.kind === 'terminal')?.panel;
      const leaf: LeafNode | null = profileId
        ? newLeaf(profileId, panel.kind === 'terminal' ? panel.cwd : null)
        : panel.kind === 'ssh'
          ? newSshLeaf(panel.target, panel.connectionId)
          : panel.kind === 'sftp'
            ? { type: 'leaf', id: crypto.randomUUID(), panel: { ...panel } }
            : panel.kind === 'terminal'
              ? newLeaf(panel.profileId, panel.cwd)
              : shell?.kind === 'terminal'
                ? newLeaf(shell.profileId, null)
                : null;
      if (!leaf) return;
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, current.id, direction, leaf),
        activeLeafId: leaf.id,
      }));
    },

    splitWithSsh: (target, connectionId, direction = 'row') => {
      const tab = activeTab();
      const leaf = newSshLeaf(target, connectionId);
      if (!tab) {
        addTab(leaf);
        return;
      }
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, t.activeLeafId, direction, leaf),
        activeLeafId: leaf.id,
      }));
    },

    addShellBeside: (sshLeafId, direction = 'row') => {
      const tab = get().tabs.find((t) => findLeaf(t.root, sshLeafId));
      const ssh = tab ? findLeaf(tab.root, sshLeafId)?.panel : undefined;
      if (!tab || ssh?.kind !== 'ssh') return;
      const leaf = newSshLeaf(ssh.target, ssh.connectionId);
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, t.activeLeafId, direction, leaf),
        activeLeafId: leaf.id,
      }));
      activate(tab.id);
    },

    closeLeaf: (tabId, leafId) => {
      removePane(tabId, leafId);
      closeOrphans();
    },

    focusLeaf: (tabId, leafId) => {
      mapTab(tabId, (t) => (findLeaf(t.root, leafId) ? { ...t, activeLeafId: leafId } : t));
    },

    focusNeighbor: (dir) => {
      const tab = activeTab();
      if (!tab) return;
      const target = neighbor(tab.root, tab.activeLeafId, dir);
      if (target) get().focusLeaf(tab.id, target);
    },

    updatePanel: (tabId, leafId, patch) => {
      mapTab(tabId, (t) => ({ ...t, root: updateTreePanel(t.root, leafId, patch) }));
    },

    setSizes: (tabId, splitId, sizes) => {
      mapTab(tabId, (t) => ({ ...t, root: setTreeSizes(t.root, splitId, sizes) }));
    },

    wake: (leafId) => {
      set((s) => ({ dormant: s.dormant.filter((id) => id !== leafId) }));
    },

    snapshot: () =>
      serializeSnapshot(get().tabs, get().activeTabId, get().activeSpaceId, get().activeTabBySpace),

    hydrate: (raw, available, fallback) => {
      // The snapshot comes from a user-reachable file: sanitize, never trust.
      const snap = sanitizeSnapshot(raw);
      if (!snap || snap.tabs.length === 0) return { replaced: 0 };
      let replaced = 0;
      const fix = (n: LayoutNode): LayoutNode => {
        if (n.type === 'split') return { ...n, children: n.children.map(fix) };
        if (n.panel.kind !== 'terminal' || available.includes(n.panel.profileId)) return n;
        replaced += 1;
        return { ...n, panel: { ...n.panel, profileId: fallback } };
      };
      let tabs = snap.tabs.map((t) => ({ ...t, root: fix(t.root) }));
      // Written before spaces: each saved connection's first session becomes its pinned one.
      const legacy = !('activeSpaceId' in raw);
      if (legacy) {
        const seen = new Set<string>();
        tabs = tabs.map((t) => {
          const ssh = leaves(t.root).find((l) => l.panel.kind === 'ssh')?.panel;
          const id = ssh?.kind === 'ssh' ? ssh.connectionId : null;
          if (!id || seen.has(id)) return t;
          seen.add(id);
          return { ...t, pinnedConnectionId: id };
        });
      }
      // SSH tabs come back disconnected: no surprise connections or prompts at launch.
      const dormant = tabs.flatMap((t) =>
        leaves(t.root)
          .filter((l) => l.panel.kind === 'ssh')
          .map((l) => l.id),
      );
      set({
        tabs,
        activeTabId: snap.activeTabId,
        dormant,
        activeSpaceId: snap.activeSpaceId ?? MAIN_SPACE.id,
        activeTabBySpace: snap.activeTabBySpace ?? {},
      });
      return { replaced };
    },
  };
});
