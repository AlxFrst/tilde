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
  expect(activeLeaf().leaf.panel.profileId).toBe('wsl:Ubuntu');
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
  expect(activeLeaf().leaf.panel.profileId).toBe('pwsh');
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
