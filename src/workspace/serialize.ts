// What workspace.json keeps: each pane in the form its module saves, without the panes
// a module does not save (an editor, a preview), and without the tabs left empty.

import { serializePanel } from '@/panels/registry';
import { leaves, removeLeaf } from './tree';
import type { LayoutNode, Panel, Tab, WorkspaceSnapshot } from './types';
import { viewKeep, viewTabs, type SpaceView } from './view';

function mapLeaves(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return { ...node, panel: serializePanel(node.panel) as Panel };
  return { ...node, children: node.children.map(mapLeaves) };
}

function serializeTree(root: LayoutNode): LayoutNode | null {
  let kept: LayoutNode | null = root;
  for (const leaf of leaves(root)) {
    // removeLeaf also collapses the split and rescales the sizes.
    if (kept && serializePanel(leaf.panel) === null) kept = removeLeaf(kept, leaf.id);
  }
  return kept && mapLeaves(kept);
}

export function serializeSnapshot(
  tabs: Tab[],
  activeTabId: string | null,
  activeSpaceId: string | null = null,
  activeTabBySpace: Record<string, string> = {},
  views: Record<string, SpaceView> = {},
): WorkspaceSnapshot {
  const kept: Tab[] = [];
  for (const tab of tabs) {
    const root = serializeTree(tab.root);
    if (!root) continue;
    const ids = leaves(root).map((l) => l.id);
    const activeLeafId = ids.includes(tab.activeLeafId) ? tab.activeLeafId : (ids[0] ?? '');
    kept.push({ ...tab, root, activeLeafId });
  }
  const active = kept.some((t) => t.id === activeTabId) ? activeTabId : (kept[0]?.id ?? null);
  const bySpace = Object.fromEntries(
    Object.entries(activeTabBySpace).filter(([, id]) => kept.some((t) => t.id === id)),
  );
  // A session that is not saved (an editor alone) leaves its view.
  const saved = new Set(kept.map((t) => t.id));
  const keptViews: Record<string, SpaceView> = {};
  for (const [space, view] of Object.entries(views)) {
    const root = viewKeep(view.root, (id) => saved.has(id));
    if (root && viewTabs(root).length >= 2) keptViews[space] = { root, shown: view.shown };
  }
  return {
    version: 1,
    tabs: kept,
    activeTabId: active,
    activeSpaceId,
    activeTabBySpace: bySpace,
    views: keptViews,
  };
}
