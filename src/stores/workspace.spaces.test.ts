import { MAIN_SPACE } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import { registerCorePanels } from '@/panels/core';
import { blankConnection } from '@/stores/connections';
import {
  defaultSpaceResolver,
  isPinnedTab,
  makeSpaceResolver,
  setSpaceResolver,
  spaceOfTab,
} from '@/workspace/spaces';
import type { WorkspaceSnapshot } from '@/workspace/types';
import { useWorkspace } from './workspace';

beforeAll(() => {
  registerCorePanels();
});

const ws = () => useWorkspace.getState();
const c1 = blankConnection({ id: 'c1', name: 'prod', host: 'prod', spaceId: 'pro' });
const file = (connections = [c1]): ConnectionsFile => ({
  version: 1,
  spaces: [MAIN_SPACE, { id: 'pro', name: 'Pro', color: null, icon: null }],
  folders: [],
  connections,
  recents: [],
});
const tab = (id: string) => {
  const t = ws().tabs.find((x) => x.id === id);
  if (!t) throw new Error(`no tab ${id}`);
  return t;
};
const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);
const term = (id: string) => ({
  type: 'leaf',
  id,
  panel: { kind: 'terminal', profileId: 'cmd', cwd: null, title: null },
});
const hydrateRaw = (raw: unknown) => ws().hydrate(raw as WorkspaceSnapshot, ['cmd'], 'cmd');

beforeEach(() => {
  setSpaceResolver(makeSpaceResolver(file()));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
});
afterAll(() => {
  setSpaceResolver(defaultSpaceResolver);
});

test('new tabs belong to the active space', () => {
  ws().switchSpace('pro');
  const t = ws().openTab('cmd');
  expect(tab(t).spaceId).toBe('pro');
  expect(tab(t).pinnedConnectionId).toBeNull();
  expect(ids(ws().spaceTabs('pro'))).toEqual([t]);
});

test("switching space restores that space's last tab", () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  ws().activateTab(a);
  ws().switchSpace('pro');
  expect(ws().activeTabId).toBeNull();
  const c = ws().openTab('cmd');
  ws().switchSpace('main');
  expect(ws().activeTabId).toBe(a);
  ws().switchSpace('pro');
  expect(ws().activeTabId).toBe(c);
  expect(ids(ws().spaceTabs('main'))).toEqual([a, b]);
});

test('activating a session of another space switches to it', () => {
  ws().switchSpace('pro');
  const p = ws().openTab('cmd');
  ws().switchSpace('main');
  ws().activateTab(p);
  expect(ws().activeSpaceId).toBe('pro');
});

test("a pinned session follows its connection's space", () => {
  const t = ws().openPinned('c1', 'prod', 'pro');
  expect(ws().activeSpaceId).toBe('pro');
  expect(spaceOfTab(tab(t))).toBe('pro');
  setSpaceResolver(makeSpaceResolver(file([{ ...c1, spaceId: 'main' }])));
  expect(spaceOfTab(tab(t))).toBe('main');
  expect(ids(ws().spaceTabs('main'))).toEqual([t]);
});

test('opening a pinned connection twice activates the same session and switches space', () => {
  const t1 = ws().openPinned('c1', 'prod', 'pro');
  ws().switchSpace('main');
  const t2 = ws().openPinned('c1', 'prod', 'pro');
  expect(t2).toBe(t1);
  expect(ws().tabs).toHaveLength(1);
  expect(ws().activeSpaceId).toBe('pro');
  expect(ws().activeTabId).toBe(t1);
});

test('a connection keeps all its sessions: the first is its row, the others go under it', () => {
  const t1 = ws().openPinned('c1', 'prod', 'pro');
  const t2 = ws().openSshTab('prod', 'c1');
  ws().pinTab(t2, 'c1');
  expect(tab(t1).pinnedConnectionId).toBe('c1');
  expect(tab(t2).pinnedConnectionId).toBe('c1');
  expect(ws().openPinned('c1', 'prod', 'pro')).toBe(t1);
  const t3 = ws().openAnotherSession('c1', 'prod', 'pro');
  expect(spaceOfTab(tab(t3))).toBe('pro');
  expect(ws().tabs.map((x) => x.id)).toEqual([t1, t2, t3]);
});

test('unpinning keeps the session where it is', () => {
  const t = ws().openPinned('c1', 'prod', 'pro');
  ws().unpinTab(t);
  expect(tab(t).pinnedConnectionId).toBeNull();
  expect(spaceOfTab(tab(t))).toBe('pro');
});

test('a session pinned to a deleted connection counts as unpinned', () => {
  const t = ws().openPinned('c1', 'prod', 'pro');
  setSpaceResolver(makeSpaceResolver(file([])));
  expect(isPinnedTab(tab(t))).toBe(false);
  expect(spaceOfTab(tab(t))).toBe('pro');
});

test('closing a tab activates a neighbour of the same space', () => {
  ws().openTab('cmd');
  ws().switchSpace('pro');
  const c = ws().openTab('cmd');
  const d = ws().openTab('cmd');
  ws().closeTab(d);
  expect(ws().activeTabId).toBe(c);
  ws().closeTab(c);
  expect(ws().activeTabId).toBeNull();
  expect(ws().activeSpaceId).toBe('pro');
});

test('ctrl+tab cycles within the space', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  ws().switchSpace('pro');
  ws().openTab('cmd');
  ws().switchSpace('main');
  ws().activateTab(a);
  ws().activateRelative(1);
  expect(ws().activeTabId).toBe(b);
  ws().activateRelative(1);
  expect(ws().activeTabId).toBe(a);
});

test("otherTabs and tabsAfter stay within the space and Aujourd'hui", () => {
  setSpaceResolver(makeSpaceResolver(file([{ ...c1, spaceId: 'main' }])));
  const p = ws().openPinned('c1', 'prod', 'main');
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  const c = ws().openTab('cmd');
  ws().switchSpace('pro');
  ws().openTab('cmd');
  expect(ws().otherTabs(a)).toEqual([p, b, c]);
  expect(ws().tabsAfter(a)).toEqual([b, c]);
  expect(ws().tabsAfter(p)).toEqual([]);
});

test('moving a session to another space keeps the user in the current one', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('cmd');
  ws().moveTabToSpace(b, 'pro');
  expect(spaceOfTab(tab(b))).toBe('pro');
  expect(ws().activeSpaceId).toBe('main');
  expect(ws().activeTabId).toBe(a);
});

test('snapshot round-trips spaces, pins and active tabs', () => {
  const p = ws().openPinned('c1', 'prod', 'pro');
  ws().switchSpace('main');
  const m = ws().openTab('cmd');
  const snap = ws().snapshot();
  expect(snap.activeSpaceId).toBe('main');
  expect(snap.activeTabBySpace).toEqual({ pro: p, main: m });
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
  ws().hydrate(snap, ['cmd'], 'cmd');
  expect(ws().snapshot()).toEqual(snap);
  expect(tab(p).pinnedConnectionId).toBe('c1');
});

test("a legacy snapshot pins each saved connection's first session", () => {
  const ssh = (id: string, connectionId: string | null) => ({
    type: 'leaf',
    id,
    panel: { kind: 'ssh', target: 'prod', connectionId, cwd: null, title: null },
  });
  const t = (id: string, root: unknown) => ({
    id,
    customTitle: null,
    color: null,
    root,
    activeLeafId: '',
  });
  hydrateRaw({
    version: 1,
    tabs: [
      t('t1', ssh('a', 'c1')),
      t('t2', ssh('b', 'c1')),
      t('t3', ssh('c', null)),
      t('t4', term('d')),
    ],
    activeTabId: 't2',
  });
  expect(ws().tabs.map((x) => x.pinnedConnectionId)).toEqual(['c1', null, null, null]);
  expect(ws().tabs.map((x) => x.spaceId)).toEqual([null, null, null, null]);
  expect(ws().activeTabId).toBe('t2');
});

test('hostile space fields are dropped', () => {
  hydrateRaw({
    version: 1,
    tabs: [
      {
        id: 'g',
        customTitle: null,
        color: null,
        root: term('a'),
        activeLeafId: 'a',
        spaceId: 5,
        pinnedConnectionId: {},
      },
    ],
    activeTabId: 'g',
    activeSpaceId: [],
    activeTabBySpace: { x: 3, main: 'missing', pro: 'g' },
  });
  expect(tab('g').spaceId).toBeNull();
  expect(tab('g').pinnedConnectionId).toBeNull();
  expect(ws().activeSpaceId).toBe('main');
  expect(ws().activeTabBySpace).toEqual({ pro: 'g' });
});

test('an unknown active space falls back to the first space', () => {
  const a = ws().openTab('cmd');
  useWorkspace.setState({ activeSpaceId: 'gone' });
  ws().reconcileSpaces(['main', 'pro']);
  expect(ws().activeSpaceId).toBe('main');
  expect(ws().activeTabId).toBe(a);
});
