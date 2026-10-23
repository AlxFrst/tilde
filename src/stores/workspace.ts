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
  FocusDirection,
  LayoutNode,
  LeafNode,
  Tab,
  TerminalPanel,
  WorkspaceSnapshot,
} from '@/workspace/types';

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (profileId: string, cwd?: string | null) => string;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  activateRelative: (delta: 1 | -1) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  renameTab: (tabId: string, title: string | null) => void;
  setTabColor: (tabId: string, color: string | null) => void;
  splitActive: (direction: Direction, profileId?: string) => void;
  closeLeaf: (tabId: string, leafId: string) => void;
  focusLeaf: (tabId: string, leafId: string) => void;
  focusNeighbor: (dir: FocusDirection) => void;
  updatePanel: (tabId: string, leafId: string, patch: Partial<TerminalPanel>) => void;
  setSizes: (tabId: string, splitId: string, sizes: number[]) => void;
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

function isNode(n: unknown): n is LayoutNode {
  if (typeof n !== 'object' || n === null) return false;
  const node = n as Partial<LayoutNode>;
  if (node.type === 'leaf') {
    const p = node.panel;
    return typeof node.id === 'string' && p?.kind === 'terminal' && typeof p.profileId === 'string';
  }
  if (node.type === 'split') {
    const s = node as Partial<{ children: unknown; sizes: unknown }>;
    return (
      Array.isArray(s.children) &&
      Array.isArray(s.sizes) &&
      s.children.length === s.sizes.length &&
      s.children.length > 0 &&
      s.children.every(isNode)
    );
  }
  return false;
}

function isSnapshot(s: unknown): s is WorkspaceSnapshot {
  if (typeof s !== 'object' || s === null) return false;
  const snap = s as Partial<WorkspaceSnapshot>;
  return (
    snap.version === 1 &&
    Array.isArray(snap.tabs) &&
    snap.tabs.every((t) => typeof t.id === 'string' && isNode(t.root))
  );
}

/** Index of the tab to activate after removing the one at `index`. */
const neighborIndex = (index: number, remaining: number) => Math.min(index, remaining - 1);

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  const mapTab = (tabId: string, f: (t: Tab) => Tab) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? f(t) : t)) }));
  };
  const activeTab = () => get().tabs.find((t) => t.id === get().activeTabId);

  return {
    tabs: [],
    activeTabId: null,

    openTab: (profileId, cwd = null) => {
      const leaf = newLeaf(profileId, cwd);
      const tab: Tab = {
        id: crypto.randomUUID(),
        customTitle: null,
        color: null,
        root: leaf,
        activeLeafId: leaf.id,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      return tab.id;
    },

    closeTab: (tabId) => {
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === tabId);
        if (index < 0) return s;
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          s.activeTabId !== tabId
            ? s.activeTabId
            : (tabs[neighborIndex(index, tabs.length)]?.id ?? null);
        return { tabs, activeTabId };
      });
    },

    activateTab: (tabId) => {
      if (get().tabs.some((t) => t.id === tabId)) set({ activeTabId: tabId });
    },

    activateRelative: (delta) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === activeTabId);
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (next) set({ activeTabId: next.id });
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
      const leaf = newLeaf(profileId ?? current.panel.profileId, current.panel.cwd);
      mapTab(tab.id, (t) => ({
        ...t,
        root: splitLeaf(t.root, current.id, direction, leaf),
        activeLeafId: leaf.id,
      }));
    },

    closeLeaf: (tabId, leafId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const before = leaves(tab.root);
      const root = removeLeaf(tab.root, leafId);
      if (!root) {
        get().closeTab(tabId);
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

    snapshot: () => ({ version: 1, tabs: get().tabs, activeTabId: get().activeTabId }),

    hydrate: (snap, available, fallback) => {
      if (!isSnapshot(snap)) return { replaced: 0 };
      let replaced = 0;
      const fix = (n: LayoutNode): LayoutNode => {
        if (n.type === 'split') return { ...n, children: n.children.map(fix) };
        if (available.includes(n.panel.profileId)) return n;
        replaced += 1;
        return { ...n, panel: { ...n.panel, profileId: fallback } };
      };
      const tabs = snap.tabs.map((t) => {
        const root = fix(t.root);
        const activeLeafId = findLeaf(root, t.activeLeafId)
          ? t.activeLeafId
          : (leaves(root)[0]?.id ?? '');
        return { ...t, root, activeLeafId };
      });
      const activeTabId = tabs.some((t) => t.id === snap.activeTabId)
        ? snap.activeTabId
        : (tabs[0]?.id ?? null);
      set({ tabs, activeTabId });
      return { replaced };
    },
  };
});
