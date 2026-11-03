// The side-by-side view: several sessions of a space shown at once. Same shape as a
// session's own split tree, but its leaves are sessions (Tab ids), not panes. Pure,
// non-mutating operations, like ./tree.

import { childRects, type Rect, type SplitHandle } from './tree';
import type { Direction, Tab } from './types';

export type ViewNode =
  | { type: 'leaf'; tabId: string }
  | { type: 'split'; id: string; direction: Direction; children: ViewNode[]; sizes: number[] };

/** A space's view: shown, or set aside while a session outside it is shown alone. */
export interface SpaceView {
  root: ViewNode;
  shown: boolean;
}

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type DropZone = Edge | 'center';

export const MAX_VIEW_SESSIONS = 4;

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
/** How close to an edge a drop goes beside rather than in place (fraction of the session). */
const EDGE_ZONE = 0.25;

const equalSizes = (n: number) => Array.from({ length: n }, () => 100 / n);

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > 0 ? sizes.map((s) => (s / total) * 100) : equalSizes(sizes.length);
}

const leaf = (tabId: string): ViewNode => ({ type: 'leaf', tabId });

/** The sessions of the view, in visual order (left→right, top→bottom). */
export function viewTabs(root: ViewNode): string[] {
  return root.type === 'leaf' ? [root.tabId] : root.children.flatMap(viewTabs);
}

export function viewHas(root: ViewNode, tabId: string): boolean {
  return root.type === 'leaf' ? root.tabId === tabId : root.children.some((c) => viewHas(c, tabId));
}

function insert(
  root: ViewNode,
  targetTabId: string,
  node: ViewNode,
  direction: Direction,
  before: boolean,
): ViewNode {
  if (root.type === 'leaf') {
    if (root.tabId !== targetTabId) return root;
    return {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      children: before ? [node, root] : [root, node],
      sizes: [50, 50],
    };
  }
  const index = root.children.findIndex((c) => c.type === 'leaf' && c.tabId === targetTabId);
  if (index >= 0 && root.direction === direction) {
    const children = [...root.children];
    children.splice(before ? index : index + 1, 0, node);
    return { ...root, children, sizes: equalSizes(children.length) };
  }
  return {
    ...root,
    children: root.children.map((c) => insert(c, targetTabId, node, direction, before)),
  };
}

/**
 * Puts `tabId` beside `targetTabId` (taking it out of its old place if it was in the view).
 * Next to a sibling of the same direction it becomes one more sibling, all of equal size;
 * otherwise the target's place is split 50/50.
 */
export function viewPlace(
  root: ViewNode,
  targetTabId: string,
  tabId: string,
  edge: Edge,
): ViewNode {
  if (tabId === targetTabId || !viewHas(root, targetTabId)) return root;
  const base = viewHas(root, tabId) ? viewRemove(root, tabId) : root;
  if (!base) return root;
  const direction: Direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  return insert(base, targetTabId, leaf(tabId), direction, edge === 'left' || edge === 'top');
}

/** `tabId` in the place of `targetTabId`; the two swap if `tabId` was already in the view. */
export function viewReplace(root: ViewNode, targetTabId: string, tabId: string): ViewNode {
  if (tabId === targetTabId) return root;
  const swap = viewHas(root, tabId);
  const walk = (n: ViewNode): ViewNode => {
    if (n.type === 'split') return { ...n, children: n.children.map(walk) };
    if (n.tabId === targetTabId) return leaf(tabId);
    if (swap && n.tabId === tabId) return leaf(targetTabId);
    return n;
  };
  return walk(root);
}

/** The sessions `keep` accepts; one-child splits collapse; `null` when none is left. */
export function viewKeep(root: ViewNode, keep: (tabId: string) => boolean): ViewNode | null {
  if (root.type === 'leaf') return keep(root.tabId) ? root : null;
  const kept: { node: ViewNode; size: number }[] = [];
  root.children.forEach((child, i) => {
    const node = viewKeep(child, keep);
    if (node) kept.push({ node, size: root.sizes[i] ?? 0 });
  });
  if (kept.length === root.children.length && kept.every((k, i) => k.node === root.children[i])) {
    return root;
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]?.node ?? null;
  return {
    ...root,
    children: kept.map((k) => k.node),
    sizes: normalize(kept.map((k) => k.size)),
  };
}

export function viewRemove(root: ViewNode, tabId: string): ViewNode | null {
  return viewKeep(root, (t) => t !== tabId);
}

/**
 * The views once sessions have closed or changed space: each keeps the sessions that
 * still exist in its space (the space is checked only once `spaceOf` is known), a view
 * left with one session is dropped, and the active space's view is set aside when the
 * session shown is not in it. The same object when nothing changes.
 */
export function fixViews(
  views: Record<string, SpaceView>,
  tabs: readonly Tab[],
  spaceOf: ((tab: Tab) => string) | null,
  activeSpaceId: string,
  activeTabId: string | null,
): Record<string, SpaceView> {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  let changed = false;
  const out: Record<string, SpaceView> = {};
  for (const [space, view] of Object.entries(views)) {
    const root = viewKeep(view.root, (id) => {
      const tab = byId.get(id);
      return tab !== undefined && (spaceOf === null || spaceOf(tab) === space);
    });
    if (!root || viewTabs(root).length < 2) {
      changed = true;
      continue;
    }
    const elsewhere =
      space === activeSpaceId && (activeTabId === null || !viewHas(root, activeTabId));
    const shown = view.shown && !elsewhere;
    if (root === view.root && shown === view.shown) {
      out[space] = view;
    } else {
      changed = true;
      out[space] = { root, shown };
    }
  }
  return changed ? out : views;
}

/** Each session's rectangle, in fractions of the content area. */
export function viewRects(root: ViewNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: ViewNode, r: Rect) => {
    if (n.type === 'leaf') {
      out.set(n.tabId, r);
      return;
    }
    const subs = childRects(n, r);
    n.children.forEach((c, i) => {
      walk(c, subs[i] ?? r);
    });
  };
  walk(root, FULL);
  return out;
}

/** The draggable boundaries between sessions. */
export function viewHandles(root: ViewNode): SplitHandle[] {
  const out: SplitHandle[] = [];
  const walk = (n: ViewNode, r: Rect) => {
    if (n.type === 'leaf') return;
    const subs = childRects(n, r);
    const isRow = n.direction === 'row';
    subs.slice(1).forEach((sub, index) => {
      out.push({
        splitId: n.id,
        index,
        direction: n.direction,
        rect: r,
        position: isRow ? sub.x : sub.y,
        span: isRow ? { start: r.y, length: r.h } : { start: r.x, length: r.w },
      });
    });
    n.children.forEach((c, i) => {
      walk(c, subs[i] ?? r);
    });
  };
  walk(root, FULL);
  return out;
}

/** The split `splitId` of the view, if it is still there. */
export function viewSplitOf(
  root: ViewNode,
  splitId: string,
): Extract<ViewNode, { type: 'split' }> | null {
  if (root.type === 'leaf') return null;
  if (root.id === splitId) return root;
  for (const child of root.children) {
    const found = viewSplitOf(child, splitId);
    if (found) return found;
  }
  return null;
}

export function viewSetSizes(root: ViewNode, splitId: string, sizes: number[]): ViewNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId && sizes.length === root.children.length) {
    return { ...root, sizes: normalize(sizes) };
  }
  return { ...root, children: root.children.map((c) => viewSetSizes(c, splitId, sizes)) };
}

/**
 * Where a drop at (`x`, `y`) (fractions of the content area) lands in the session at
 * `slot`: beside it, on the nearest edge within a quarter of its size, or in its place.
 */
export function dropZoneAt(slot: Rect, x: number, y: number): DropZone {
  const rx = (x - slot.x) / slot.w;
  const ry = (y - slot.y) / slot.h;
  const distances: [Edge, number][] = [
    ['left', rx],
    ['right', 1 - rx],
    ['top', ry],
    ['bottom', 1 - ry],
  ];
  let zone: DropZone = 'center';
  let nearest = EDGE_ZONE;
  for (const [edge, d] of distances) {
    if (d < nearest) {
      nearest = d;
      zone = edge;
    }
  }
  return zone;
}

/** The part of `slot` a session dropped in `zone` will take. */
export function dropPreview(slot: Rect, zone: DropZone): Rect {
  const { x, y, w, h } = slot;
  switch (zone) {
    case 'left':
      return { x, y, w: w / 2, h };
    case 'right':
      return { x: x + w / 2, y, w: w / 2, h };
    case 'top':
      return { x, y, w, h: h / 2 };
    case 'bottom':
      return { x, y: y + h / 2, w, h: h / 2 };
    case 'center':
      return slot;
  }
}
