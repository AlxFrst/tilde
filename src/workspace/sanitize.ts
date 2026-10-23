// workspace.json is a user-reachable file: treat it as untrusted input. Whatever is
// malformed is repaired or dropped; nothing in it may crash startup or rendering.

import type { Direction, LayoutNode, Panel, Tab, WorkspaceSnapshot } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function uniqueId(raw: unknown, seen: Set<string>): string {
  const id = str(raw);
  const unique = id && !seen.has(id) ? id : crypto.randomUUID();
  seen.add(unique);
  return unique;
}

function sanitizePanel(raw: unknown): Panel | null {
  if (!isObj(raw)) return null;
  const common = { cwd: str(raw.cwd), title: str(raw.title) };
  if (raw.kind === 'ssh') {
    const target = str(raw.target)?.trim();
    return target ? { kind: 'ssh', target, ...common } : null;
  }
  if (raw.kind !== 'terminal') return null;
  const profileId = str(raw.profileId);
  if (!profileId) return null;
  return { kind: 'terminal', profileId, ...common };
}

function sanitizeSizes(raw: unknown, count: number): number[] {
  const valid =
    Array.isArray(raw) &&
    raw.length === count &&
    raw.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0);
  if (!valid) return Array.from({ length: count }, () => 100 / count);
  const sizes = raw as number[];
  const total = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => (s / total) * 100);
}

function sanitizeNode(raw: unknown, seen: Set<string>, depth = 0): LayoutNode | null {
  if (!isObj(raw) || depth > 32) return null;
  if (raw.type === 'leaf') {
    const panel = sanitizePanel(raw.panel);
    return panel ? { type: 'leaf', id: uniqueId(raw.id, seen), panel } : null;
  }
  if (raw.type !== 'split' || !Array.isArray(raw.children)) return null;
  const kept: { node: LayoutNode; size: unknown }[] = [];
  const sizes: unknown[] = Array.isArray(raw.sizes) ? raw.sizes : [];
  raw.children.forEach((child, i) => {
    const node = sanitizeNode(child, seen, depth + 1);
    if (node) kept.push({ node, size: sizes[i] });
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]?.node ?? null;
  const direction: Direction = raw.direction === 'column' ? 'column' : 'row';
  return {
    type: 'split',
    id: uniqueId(raw.id, seen),
    direction,
    children: kept.map((k) => k.node),
    sizes: sanitizeSizes(
      kept.map((k) => k.size),
      kept.length,
    ),
  };
}

function firstLeafId(n: LayoutNode): string {
  return n.type === 'leaf' ? n.id : firstLeafId(n.children[0] as LayoutNode);
}

function hasLeaf(n: LayoutNode, id: string): boolean {
  return n.type === 'leaf' ? n.id === id : n.children.some((c) => hasLeaf(c, id));
}

/** A valid snapshot built from whatever is usable in `raw`, or null if nothing is. */
export function sanitizeSnapshot(raw: unknown): WorkspaceSnapshot | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.tabs)) return null;
  const leafIds = new Set<string>();
  const tabIds = new Set<string>();
  const tabs: Tab[] = [];
  for (const t of raw.tabs) {
    if (!isObj(t)) continue;
    const root = sanitizeNode(t.root, leafIds);
    if (!root) continue;
    const wanted = str(t.activeLeafId);
    tabs.push({
      id: uniqueId(t.id, tabIds),
      customTitle: str(t.customTitle),
      color: str(t.color),
      root,
      activeLeafId: wanted && hasLeaf(root, wanted) ? wanted : firstLeafId(root),
    });
  }
  const active = str(raw.activeTabId);
  return {
    version: 1,
    tabs,
    activeTabId: tabs.some((t) => t.id === active) ? active : (tabs[0]?.id ?? null),
  };
}
