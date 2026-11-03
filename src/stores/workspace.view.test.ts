// The side-by-side view in the workspace store: which sessions are shown together.

import { MAIN_SPACE } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import { registerCorePanels } from '@/panels/core';
import { makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import type { WorkspaceSnapshot } from '@/workspace/types';
import { viewTabs } from '@/workspace/view';
import { shownView, useWorkspace } from './workspace';

beforeAll(() => {
  registerCorePanels();
});

const ws = () => useWorkspace.getState();
const file = (): ConnectionsFile => ({
  version: 1,
  spaces: [MAIN_SPACE, { id: 'pro', name: 'Pro', color: null, icon: null }],
  folders: [],
  connections: [],
  recents: [],
});
/** The sessions shown side by side, in visual order (empty without a shown view). */
const shown = () => {
  const view = shownView(ws());
  return view ? viewTabs(view) : [];
};
const open = (n: number) => Array.from({ length: n }, () => ws().openTab('cmd'));

beforeEach(() => {
  setSpaceResolver(makeSpaceResolver(file()));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
    views: {},
  });
});

test('opening a session on the right forms a shown view', () => {
  const [a = '', b = ''] = open(2);
  ws().activateTab(a);
  ws().placeInView(b, a, 'right');
  expect(shown()).toEqual([a, b]);
  expect(ws().activeTabId).toBe(b);
});

test('a session cannot be placed beside itself nor in a full view', () => {
  const [a = '', b = '', c = '', d = '', e = ''] = open(5);
  expect(ws().canPlaceInView(a, a, 'right')).toBe(false);
  ws().placeInView(b, a, 'right');
  ws().placeInView(c, b, 'right');
  ws().placeInView(d, c, 'right');
  expect(shown()).toEqual([a, b, c, d]);
  expect(ws().canPlaceInView(e, a, 'right')).toBe(false);
  expect(ws().canPlaceInView(null, a, 'right')).toBe(false);
  expect(ws().canPlaceInView(b, a, 'bottom')).toBe(true);
  expect(ws().canPlaceInView(e, a, 'center')).toBe(true);
  ws().placeInView(e, a, 'right');
  expect(shown()).toEqual([a, b, c, d]);
});

test('a centre drop swaps two members', () => {
  const [a = '', b = '', c = ''] = open(3);
  ws().placeInView(b, a, 'right');
  ws().placeInView(c, b, 'right');
  ws().placeInView(a, c, 'center');
  expect(shown()).toEqual([c, b, a]);
  expect(ws().activeTabId).toBe(a);
});

test('a centre drop of an outsider takes the place of the target', () => {
  const [a = '', b = '', c = ''] = open(3);
  ws().placeInView(b, a, 'right');
  ws().placeInView(c, a, 'center');
  expect(shown()).toEqual([c, b]);
});

test('showing a session outside the view sets the view aside, a member brings it back', () => {
  const [a = '', b = '', c = ''] = open(3);
  ws().placeInView(b, a, 'right');
  ws().activateTab(c);
  expect(shown()).toEqual([]);
  expect(ws().views.main?.shown).toBe(false);
  expect(ws().activeTabId).toBe(c);
  ws().activateTab(a);
  expect(shown()).toEqual([a, b]);
  expect(ws().activeTabId).toBe(a);
});

test('a new session sets the view aside', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  const c = ws().openTab('cmd');
  expect(ws().views.main?.shown).toBe(false);
  expect(ws().activeTabId).toBe(c);
});

test('Ctrl+Tab keeps the view while every session of the space is in it', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  ws().activateRelative(1);
  expect(shown()).toEqual([a, b]);
  ws().activateRelative(1);
  expect(shown()).toEqual([a, b]);
});

test('Ctrl+Tab through an outsider sets the view aside and brings it back', () => {
  const [a = '', b = '', c = ''] = open(3);
  ws().activateTab(a);
  ws().placeInView(b, a, 'right');
  ws().activateRelative(1); // c
  expect(ws().activeTabId).toBe(c);
  expect(shown()).toEqual([]);
  ws().activateRelative(1); // a
  expect(shown()).toEqual([a, b]);
});

test('show alone, then the same session again, brings the view back', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  ws().showAlone(a);
  expect(shown()).toEqual([]);
  expect(ws().activeTabId).toBe(a);
  ws().activateTab(a);
  expect(shown()).toEqual([a, b]);
});

test('removing the active session from the view focuses the first remaining one', () => {
  const [a = '', b = '', c = ''] = open(3);
  ws().placeInView(b, a, 'right');
  ws().placeInView(c, b, 'right');
  ws().removeFromView(c);
  expect(shown()).toEqual([a, b]);
  expect(ws().activeTabId).toBe(a);
  expect(ws().tabs).toHaveLength(3);
});

test('removing from a view of two dissolves it', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  ws().removeFromView(a);
  expect(ws().views.main).toBeUndefined();
  expect(ws().activeTabId).toBe(b);
});

test('placing beside a lone session while a view is set aside replaces that view', () => {
  const [a = '', b = '', c = '', d = ''] = open(4);
  ws().placeInView(b, a, 'right');
  ws().activateTab(c);
  ws().placeInView(d, c, 'bottom');
  expect(shown()).toEqual([c, d]);
});

test('a session of another space cannot be placed', () => {
  const [a = ''] = open(1);
  ws().switchSpace('pro');
  const p = ws().openTab('cmd');
  ws().switchSpace('main');
  expect(ws().canPlaceInView(p, a, 'right')).toBe(false);
  ws().placeInView(p, a, 'right');
  expect(ws().views).toEqual({});
});

test('resizing the shown view', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  const root = ws().views.main?.root;
  if (root?.type !== 'split') throw new Error('no split');
  ws().setViewSizes(root.id, [70, 30]);
  const after = ws().views.main?.root;
  expect(after?.type === 'split' && after.sizes).toEqual([70, 30]);
});

test('the view is saved and restored', () => {
  const [a = '', b = ''] = open(2);
  ws().placeInView(b, a, 'right');
  const snap = JSON.parse(JSON.stringify(ws().snapshot())) as WorkspaceSnapshot;
  expect(snap.views?.main?.shown).toBe(true);
  useWorkspace.setState({ tabs: [], activeTabId: null, views: {} });
  ws().hydrate(snap, ['cmd'], 'cmd');
  expect(shown()).toEqual([a, b]);
});
