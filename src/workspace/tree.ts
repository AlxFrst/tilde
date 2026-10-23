// Pure, non-mutating operations on a tab's split tree.

import type { Direction, FocusDirection, LayoutNode, LeafNode, TerminalPanel } from './types';

const equalSizes = (n: number) => Array.from({ length: n }, () => 100 / n);

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > 0 ? sizes.map((s) => (s / total) * 100) : equalSizes(sizes.length);
}

/** All leaves, in visual order (left→right, top→bottom). */
export function leaves(root: LayoutNode): LeafNode[] {
  return root.type === 'leaf' ? [root] : root.children.flatMap(leaves);
}

export function findLeaf(root: LayoutNode, leafId: string): LeafNode | null {
  return leaves(root).find((l) => l.id === leafId) ?? null;
}

/**
 * Splits `leafId`, placing `newLeaf` after it. Inside a split of the same direction the
 * new pane becomes a sibling and all siblings get equal sizes; otherwise the leaf is
 * replaced by a 50/50 split.
 */
export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  direction: Direction,
  newLeaf: LeafNode,
): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === leafId
      ? {
          type: 'split',
          id: crypto.randomUUID(),
          direction,
          children: [root, newLeaf],
          sizes: [50, 50],
        }
      : root;
  }
  const index = root.children.findIndex((c) => c.type === 'leaf' && c.id === leafId);
  if (index >= 0 && root.direction === direction) {
    const children = [...root.children];
    children.splice(index + 1, 0, newLeaf);
    return { ...root, children, sizes: equalSizes(children.length) };
  }
  return { ...root, children: root.children.map((c) => splitLeaf(c, leafId, direction, newLeaf)) };
}

/** Removes a leaf; collapses one-child splits; `null` when nothing is left. */
export function removeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  const kept: { node: LayoutNode; size: number }[] = [];
  root.children.forEach((child, i) => {
    const node = removeLeaf(child, leafId);
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

export function updatePanel(
  root: LayoutNode,
  leafId: string,
  patch: Partial<TerminalPanel>,
): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === leafId ? { ...root, panel: { ...root.panel, ...patch } } : root;
  }
  return { ...root, children: root.children.map((c) => updatePanel(c, leafId, patch)) };
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId && sizes.length === root.children.length) {
    return { ...root, sizes: normalize(sizes) };
  }
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rects(node: LayoutNode, r: Rect, out: Map<string, Rect>): Map<string, Rect> {
  if (node.type === 'leaf') return out.set(node.id, r);
  let offset = 0;
  node.children.forEach((child, i) => {
    const share = (node.sizes[i] ?? 0) / 100;
    const sub =
      node.direction === 'row'
        ? { x: r.x + offset * r.w, y: r.y, w: share * r.w, h: r.h }
        : { x: r.x, y: r.y + offset * r.h, w: r.w, h: share * r.h };
    offset += share;
    rects(child, sub, out);
  });
  return out;
}

const EPS = 1e-6;

/**
 * The pane next to `leafId` in direction `dir`: among panes strictly on that side whose
 * extent overlaps on the other axis, the closest edge wins, then the closest center,
 * then the top/left-most.
 */
export function neighbor(root: LayoutNode, leafId: string, dir: FocusDirection): string | null {
  const all = rects(root, { x: 0, y: 0, w: 1, h: 1 }, new Map());
  const cur = all.get(leafId);
  if (!cur) return null;
  const horizontal = dir === 'left' || dir === 'right';
  let best: { id: string; edge: number; center: number; pos: number } | null = null;
  for (const [id, r] of all) {
    if (id === leafId) continue;
    const edge =
      dir === 'right'
        ? r.x - (cur.x + cur.w)
        : dir === 'left'
          ? cur.x - (r.x + r.w)
          : dir === 'down'
            ? r.y - (cur.y + cur.h)
            : cur.y - (r.y + r.h);
    if (edge < -EPS) continue;
    const overlaps = horizontal
      ? r.y < cur.y + cur.h - EPS && r.y + r.h > cur.y + EPS
      : r.x < cur.x + cur.w - EPS && r.x + r.w > cur.x + EPS;
    if (!overlaps) continue;
    const center = horizontal
      ? Math.abs(r.y + r.h / 2 - (cur.y + cur.h / 2))
      : Math.abs(r.x + r.w / 2 - (cur.x + cur.w / 2));
    const pos = horizontal ? r.y : r.x;
    const better =
      !best ||
      edge < best.edge - EPS ||
      (Math.abs(edge - best.edge) <= EPS &&
        (center < best.center - EPS || (Math.abs(center - best.center) <= EPS && pos < best.pos)));
    if (better) best = { id, edge, center, pos };
  }
  return best?.id ?? null;
}
