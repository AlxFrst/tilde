// The side-by-side view in workspace.json: saved with the sessions, repaired on load.

import { registerCorePanels } from '@/panels/core';
import { sanitizeSnapshot, sanitizeViews } from './sanitize';
import { serializeSnapshot } from './serialize';
import type { LeafNode, Panel, Tab } from './types';
import type { SpaceView, ViewNode } from './view';

beforeAll(() => {
  registerCorePanels();
});

const terminal: Panel = { kind: 'terminal', profileId: 'cmd', cwd: null, title: null };
const editor: Panel = {
  kind: 'editor',
  source: { kind: 'local', docId: 1, name: 'NOTES.md' },
  cwd: null,
  title: null,
};
const tab = (id: string, panel: Panel = terminal): Tab => {
  const root: LeafNode = { type: 'leaf', id: `${id}-1`, panel };
  return {
    id,
    customTitle: null,
    color: null,
    root,
    activeLeafId: root.id,
    spaceId: null,
    pinnedConnectionId: null,
  };
};
const L = (tabId: string): ViewNode => ({ type: 'leaf', tabId });
const row = (...tabs: string[]): ViewNode => ({
  type: 'split',
  id: 'v1',
  direction: 'row',
  children: tabs.map(L),
  sizes: tabs.map(() => 100 / tabs.length),
});
const ids = (n: ViewNode): string[] => (n.type === 'leaf' ? [n.tabId] : n.children.flatMap(ids));

test('serialize drops a view member whose session is not saved', () => {
  const tabs = [tab('a'), tab('b'), tab('ed', editor)];
  const three = serializeSnapshot(
    tabs,
    'a',
    'main',
    {},
    { main: { root: row('a', 'ed', 'b'), shown: true } },
  );
  expect(three.views?.main && ids(three.views.main.root)).toEqual(['a', 'b']);
  const two = serializeSnapshot(
    tabs,
    'a',
    'main',
    {},
    { main: { root: row('a', 'ed'), shown: true } },
  );
  expect(two.views).toEqual({});
});

test('a saved view comes back as it was', () => {
  const views: Record<string, SpaceView> = {
    main: {
      root: {
        type: 'split',
        id: 'v1',
        direction: 'row',
        children: [
          L('a'),
          {
            type: 'split',
            id: 'v2',
            direction: 'column',
            children: [L('b'), L('c')],
            sizes: [30, 70],
          },
        ],
        sizes: [60, 40],
      },
      shown: false,
    },
  };
  const saved = serializeSnapshot([tab('a'), tab('b'), tab('c')], 'a', 'main', {}, views);
  const back = sanitizeSnapshot(JSON.parse(JSON.stringify(saved)));
  expect(back?.views).toEqual(views);
});

test('a file without views opens with none', () => {
  const saved = serializeSnapshot([tab('a')], 'a');
  const raw = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  delete raw.views;
  expect(sanitizeSnapshot(raw)?.views).toEqual({});
});

describe('sanitizeViews repairs what it can', () => {
  const known = new Set(['a', 'b', 'c']);

  test('anything but an object is no view', () => {
    expect(sanitizeViews(null, known)).toEqual({});
    expect(sanitizeViews([row('a', 'b')], known)).toEqual({});
    expect(sanitizeViews({ main: 'row' }, known)).toEqual({});
  });

  test('a session that no longer exists leaves the view', () => {
    const out = sanitizeViews({ main: { root: row('a', 'gone', 'b'), shown: true } }, known);
    expect(out.main && ids(out.main.root)).toEqual(['a', 'b']);
    expect(out.main?.shown).toBe(true);
  });

  test('a session is in one view only', () => {
    const out = sanitizeViews(
      { main: { root: row('a', 'b'), shown: true }, pro: { root: row('b', 'c'), shown: true } },
      known,
    );
    expect(out.main && ids(out.main.root)).toEqual(['a', 'b']);
    expect(out.pro).toBeUndefined();
  });

  test('shown must be true to show', () => {
    expect(sanitizeViews({ main: { root: row('a', 'b'), shown: 'yes' } }, known).main?.shown).toBe(
      false,
    );
  });

  test('bad sizes become equal', () => {
    const out = sanitizeViews(
      { main: { root: { ...row('a', 'b'), sizes: [-1, 'x'] }, shown: true } },
      known,
    );
    expect(out.main?.root.type === 'split' && out.main.root.sizes).toEqual([50, 50]);
  });

  test('a view left with one session is dropped', () => {
    expect(sanitizeViews({ main: { root: row('a', 'gone'), shown: true } }, known)).toEqual({});
  });

  test('a view nested too deep is dropped', () => {
    let deep: unknown = row('a', 'b');
    for (let i = 0; i < 40; i++) {
      deep = {
        type: 'split',
        id: `d${String(i)}`,
        direction: 'row',
        children: [deep],
        sizes: [100],
      };
    }
    expect(sanitizeViews({ main: { root: deep, shown: true } }, known)).toEqual({});
  });
});
