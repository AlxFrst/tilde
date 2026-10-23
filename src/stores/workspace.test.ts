import { leaves } from '@/workspace/tree';
import type { WorkspaceSnapshot } from '@/workspace/types';
import { useWorkspace } from './workspace';

const ws = () => useWorkspace.getState();

function activeLeaf() {
  const tab = ws().tabs.find((t) => t.id === ws().activeTabId);
  if (!tab) throw new Error('no active tab');
  const l = leaves(tab.root).find((x) => x.id === tab.activeLeafId);
  if (!l) throw new Error('no active leaf');
  return { tab, leaf: l };
}

beforeEach(() => {
  useWorkspace.setState({ tabs: [], activeTabId: null });
});

test('openTab activates the new tab', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('pwsh', 'C:\\x');
  expect(ws().activeTabId).toBe(b);
  expect(ws().tabs.map((t) => t.id)).toEqual([a, b]);
  expect(activeLeaf().leaf.panel).toEqual({
    kind: 'terminal',
    profileId: 'pwsh',
    cwd: 'C:\\x',
    title: null,
  });
});

test('closing the last leaf closes the tab and activates a neighbor', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  const c = ws().openTab('cmd');
  ws().activateTab(b);
  ws().closeLeaf(b, activeLeaf().leaf.id);
  expect(ws().tabs.map((t) => t.id)).toEqual([a, c]);
  expect(ws().activeTabId).toBe(c);
  ws().closeTab(c);
  expect(ws().activeTabId).toBe(a);
  ws().closeTab(a);
  expect(ws().activeTabId).toBeNull();
});

test('splitActive inherits profile and cwd', () => {
  ws().openTab('pwsh', 'C:\\x');
  const first = activeLeaf().leaf.id;
  ws().splitActive('row');
  const { tab, leaf } = activeLeaf();
  expect(leaf.id).not.toBe(first);
  expect(leaf.panel).toMatchObject({ profileId: 'pwsh', cwd: 'C:\\x' });
  expect(leaves(tab.root)).toHaveLength(2);
});

test('splitActive can use another profile', () => {
  ws().openTab('pwsh');
  ws().splitActive('column', 'wsl:Ubuntu');
  expect(activeLeaf().leaf.panel).toMatchObject({ profileId: 'wsl:Ubuntu' });
});

test('closing one of two panes keeps the tab', () => {
  const t = ws().openTab('cmd');
  ws().splitActive('row');
  ws().closeLeaf(t, activeLeaf().leaf.id);
  expect(ws().tabs).toHaveLength(1);
  expect(leaves(activeLeaf().tab.root)).toHaveLength(1);
  expect(activeLeaf().leaf.id).toBe(activeLeaf().tab.activeLeafId);
});

test('moveTab reorders', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  const c = ws().openTab('cmd');
  ws().moveTab(0, 2);
  expect(ws().tabs.map((t) => t.id)).toEqual([b, c, a]);
});

test('activateRelative wraps around', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  ws().activateRelative(1);
  expect(ws().activeTabId).toBe(a);
  ws().activateRelative(-1);
  expect(ws().activeTabId).toBe(b);
});

test('focusNeighbor moves between panes', () => {
  ws().openTab('cmd');
  const first = activeLeaf().leaf.id;
  ws().splitActive('row');
  ws().focusNeighbor('left');
  expect(activeLeaf().leaf.id).toBe(first);
});

test('renameTab and setTabColor', () => {
  const t = ws().openTab('cmd');
  ws().renameTab(t, 'prod');
  ws().setTabColor(t, '#F7768E');
  expect(ws().tabs[0]).toMatchObject({ customTitle: 'prod', color: '#F7768E' });
  ws().renameTab(t, null);
  expect(ws().tabs[0]?.customTitle).toBeNull();
});

test('snapshot and hydrate roundtrip', () => {
  ws().openTab('cmd');
  ws().splitActive('column');
  const snap = ws().snapshot();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  const { replaced } = ws().hydrate(snap, ['cmd'], 'cmd');
  expect(replaced).toBe(0);
  expect(ws().snapshot()).toEqual(snap);
});

test('hydrate replaces unknown profiles', () => {
  ws().openTab('wsl:Gone');
  const snap = ws().snapshot();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  const { replaced } = ws().hydrate(snap, ['pwsh'], 'pwsh');
  expect(replaced).toBe(1);
  expect(activeLeaf().leaf.panel).toMatchObject({ profileId: 'pwsh' });
});

test('hydrate ignores an invalid snapshot', () => {
  ws().openTab('cmd');
  const before = ws().snapshot();
  expect(ws().hydrate({ version: 2 } as unknown as WorkspaceSnapshot, ['cmd'], 'cmd')).toEqual({
    replaced: 0,
  });
  expect(ws().hydrate(null as unknown as WorkspaceSnapshot, ['cmd'], 'cmd')).toEqual({
    replaced: 0,
  });
  expect(ws().snapshot()).toEqual(before);
});

const term = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'leaf',
  id,
  panel: { kind: 'terminal', profileId: 'cmd', cwd: null, title: null, ...extra },
});

function hydrateRaw(raw: unknown) {
  return ws().hydrate(raw as WorkspaceSnapshot, ['cmd'], 'cmd');
}

test('hostile snapshots never throw and keep what is usable', () => {
  const good = { id: 'g', customTitle: null, color: null, root: term('a'), activeLeafId: 'a' };
  expect(() =>
    hydrateRaw({ version: 1, tabs: [null, 42, { id: 'x' }, good], activeTabId: 'g' }),
  ).not.toThrow();
  expect(ws().tabs.map((t) => t.id)).toEqual(['g']);
});

test('wrong field types are reset instead of crashing the UI', () => {
  hydrateRaw({
    version: 1,
    tabs: [
      {
        id: 't',
        customTitle: { evil: true },
        color: 7,
        root: term('a', { title: ['x'], cwd: 12 }),
        activeLeafId: 'a',
      },
    ],
    activeTabId: 't',
  });
  const [t] = ws().tabs;
  expect(t?.customTitle).toBeNull();
  expect(t?.color).toBeNull();
  expect(leaves(t?.root ?? (term('z') as never))[0]?.panel).toMatchObject({
    title: null,
    cwd: null,
  });
});

test('bad split sizes are normalized and bad directions fixed', () => {
  hydrateRaw({
    version: 1,
    tabs: [
      {
        id: 't',
        customTitle: null,
        color: null,
        root: {
          type: 'split',
          id: 's',
          direction: 'diagonal',
          children: [term('a'), term('b')],
          sizes: ['a', -5],
        },
        activeLeafId: 'a',
      },
    ],
    activeTabId: 't',
  });
  const root = ws().tabs[0]?.root;
  expect(root).toMatchObject({ type: 'split', direction: 'row', sizes: [50, 50] });
});

test('duplicate leaf ids are made unique', () => {
  hydrateRaw({
    version: 1,
    tabs: [
      {
        id: 't',
        customTitle: null,
        color: null,
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          children: [term('a'), term('a')],
          sizes: [50, 50],
        },
        activeLeafId: 'a',
      },
    ],
    activeTabId: 't',
  });
  const ids = leaves(ws().tabs[0]?.root ?? (term('z') as never)).map((l) => l.id);
  expect(new Set(ids).size).toBe(2);
});

test('openSshTab opens an ssh panel and splitting it reconnects to the same target', () => {
  ws().openSshTab('prod');
  expect(activeLeaf().leaf.panel).toEqual({ kind: 'ssh', target: 'prod', cwd: null, title: null });
  ws().splitActive('row');
  expect(activeLeaf().leaf.panel).toEqual({ kind: 'ssh', target: 'prod', cwd: null, title: null });
  ws().splitActive('row', 'cmd');
  expect(activeLeaf().leaf.panel).toMatchObject({ kind: 'terminal', profileId: 'cmd' });
});

test('hydrate keeps ssh panels and never replaces them with a local profile', () => {
  ws().openSshTab('root@db:2222');
  ws().openTab('wsl:Gone');
  const snap = ws().snapshot();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  const { replaced } = ws().hydrate(snap, ['pwsh'], 'pwsh');
  expect(replaced).toBe(1);
  const panels = ws().tabs.map((t) => leaves(t.root)[0]?.panel);
  expect(panels[0]).toEqual({ kind: 'ssh', target: 'root@db:2222', cwd: null, title: null });
  expect(panels[1]).toMatchObject({ kind: 'terminal', profileId: 'pwsh' });
});

test('an ssh panel without a target is dropped from a snapshot', () => {
  hydrateRaw({
    version: 1,
    tabs: [
      { id: 'a', root: { type: 'leaf', id: 'x', panel: { kind: 'ssh', target: '' } } },
      { id: 'b', root: { type: 'leaf', id: 'y', panel: { kind: 'ssh', target: 'srv' } } },
    ],
    activeTabId: 'a',
  });
  expect(ws().tabs.map((t) => t.id)).toEqual(['b']);
});
