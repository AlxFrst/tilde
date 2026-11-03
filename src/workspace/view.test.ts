import type { Tab } from './types';
import {
  dropPreview,
  dropZoneAt,
  fixViews,
  viewHandles,
  viewHas,
  viewKeep,
  viewPlace,
  viewRects,
  viewRemove,
  viewReplace,
  viewSetSizes,
  viewTabs,
  type ViewNode,
} from './view';

const L = (tabId: string): ViewNode => ({ type: 'leaf', tabId });
const split = (direction: 'row' | 'column', children: ViewNode[], sizes?: number[]): ViewNode => ({
  type: 'split',
  id: `s-${children.map((c) => (c.type === 'leaf' ? c.tabId : c.id)).join('')}`,
  direction,
  children,
  sizes: sizes ?? children.map(() => 100 / children.length),
});
const row = (...tabs: string[]) => split('row', tabs.map(L));
const full = { x: 0, y: 0, w: 1, h: 1 };

test('placing to the right of a lone session makes a 50/50 row', () => {
  expect(viewPlace(L('a'), 'a', 'b', 'right')).toMatchObject({
    type: 'split',
    direction: 'row',
    children: [L('a'), L('b')],
    sizes: [50, 50],
  });
});

test('placing to the left or on top puts the session first', () => {
  expect(viewPlace(L('a'), 'a', 'b', 'left')).toMatchObject({ children: [L('b'), L('a')] });
  expect(viewPlace(L('a'), 'a', 'b', 'top')).toMatchObject({
    direction: 'column',
    children: [L('b'), L('a')],
  });
});

test('placing beside a member of a row of the same direction adds a sibling, equal sizes', () => {
  const out = viewPlace(row('a', 'b'), 'a', 'c', 'right');
  expect(viewTabs(out)).toEqual(['a', 'c', 'b']);
  expect(out.type === 'split' && out.sizes.map(Math.round)).toEqual([33, 33, 33]);
});

test('placing below a member of a row nests a column in its place', () => {
  const out = viewPlace(row('a', 'b'), 'b', 'c', 'bottom');
  expect(out).toMatchObject({
    direction: 'row',
    children: [L('a'), { type: 'split', direction: 'column', children: [L('b'), L('c')] }],
  });
});

test('placing a session already in the view moves it', () => {
  expect(viewTabs(viewPlace(row('a', 'b', 'c'), 'c', 'a', 'right'))).toEqual(['b', 'c', 'a']);
});

test('placing a session beside itself, or beside a session not in the view, changes nothing', () => {
  const root = row('a', 'b');
  expect(viewPlace(root, 'a', 'a', 'right')).toBe(root);
  expect(viewPlace(root, 'z', 'c', 'right')).toBe(root);
});

test('replacing puts an outsider in the target place', () => {
  expect(viewTabs(viewReplace(row('a', 'b'), 'b', 'c'))).toEqual(['a', 'c']);
});

test('replacing with a member swaps them', () => {
  expect(viewTabs(viewReplace(row('a', 'b', 'c'), 'a', 'c'))).toEqual(['c', 'b', 'a']);
});

test('removing collapses one-child splits and rescales', () => {
  const out = viewRemove(split('row', [L('a'), L('b'), L('c')], [20, 30, 50]), 'b');
  expect(out?.type === 'split' && out.sizes.map((s) => Math.round(s * 100) / 100)).toEqual([
    28.57, 71.43,
  ]);
  expect(viewRemove(row('a', 'b'), 'a')).toEqual(L('b'));
  expect(viewRemove(L('a'), 'a')).toBeNull();
});

test('keeping every session returns the same tree', () => {
  const root = split('row', [L('a'), row('b', 'c')]);
  expect(viewKeep(root, () => true)).toBe(root);
  expect(viewTabs(viewKeep(root, (t) => t !== 'c') ?? L('?'))).toEqual(['a', 'b']);
});

test('membership', () => {
  expect(viewHas(row('a', 'b'), 'b')).toBe(true);
  expect(viewHas(row('a', 'b'), 'c')).toBe(false);
});

test('rects follow the sizes', () => {
  const rects = viewRects(split('row', [L('a'), L('b')], [60, 40]));
  expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 0.6, h: 1 });
  expect(rects.get('b')?.x).toBeCloseTo(0.6);
  expect(rects.get('b')?.w).toBeCloseTo(0.4);
});

test('one handle between two sessions, and sizes can be set on it', () => {
  const root = row('a', 'b');
  const [h] = viewHandles(root);
  expect(viewHandles(root)).toHaveLength(1);
  expect(h).toMatchObject({ index: 0, direction: 'row', position: 0.5 });
  const out = viewSetSizes(root, h?.splitId ?? '', [70, 30]);
  expect(out.type === 'split' && out.sizes).toEqual([70, 30]);
});

test('a drop zone is the nearest edge within a quarter, else the centre', () => {
  expect(dropZoneAt(full, 0.9, 0.5)).toBe('right');
  expect(dropZoneAt(full, 0.1, 0.5)).toBe('left');
  expect(dropZoneAt(full, 0.5, 0.05)).toBe('top');
  expect(dropZoneAt(full, 0.5, 0.95)).toBe('bottom');
  expect(dropZoneAt(full, 0.5, 0.5)).toBe('center');
  expect(dropZoneAt({ x: 0.5, y: 0, w: 0.5, h: 1 }, 0.55, 0.5)).toBe('left');
});

test('the preview is the part the session will take', () => {
  expect(dropPreview(full, 'right')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  expect(dropPreview(full, 'top')).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
  expect(dropPreview(full, 'center')).toEqual(full);
});

describe('fixViews', () => {
  const tab = (id: string, spaceId: string | null = null): Tab => ({
    id,
    customTitle: null,
    color: null,
    root: {
      type: 'leaf',
      id: `${id}-1`,
      panel: { kind: 'terminal', profileId: 'cmd', cwd: null, title: null },
    },
    activeLeafId: `${id}-1`,
    spaceId,
    pinnedConnectionId: null,
  });
  const spaceOf = (t: Tab) => t.spaceId ?? 'main';
  const tabs = [tab('a'), tab('b'), tab('c'), tab('p', 'pro')];
  const tabsOf = (v: ReturnType<typeof fixViews>, space: string) => {
    const root = v[space]?.root;
    return root ? viewTabs(root) : [];
  };

  test('a valid set of views is returned as it is', () => {
    const views = { main: { root: row('a', 'b'), shown: true } };
    expect(fixViews(views, tabs, spaceOf, 'main', 'a')).toBe(views);
  });

  test('a session that no longer exists leaves its view, a view of one is dropped', () => {
    const views = { main: { root: row('a', 'b', 'gone'), shown: true } };
    expect(tabsOf(fixViews(views, tabs, spaceOf, 'main', 'a'), 'main')).toEqual(['a', 'b']);
    const two = { main: { root: row('a', 'gone'), shown: true } };
    expect(fixViews(two, tabs, spaceOf, 'main', 'a')).toEqual({});
  });

  test('a session of another space leaves the view only once spaces are known', () => {
    const views = { main: { root: row('a', 'b', 'p'), shown: true } };
    expect(fixViews(views, tabs, null, 'main', 'a')).toBe(views);
    expect(tabsOf(fixViews(views, tabs, spaceOf, 'main', 'a'), 'main')).toEqual(['a', 'b']);
  });

  test('a shown view whose space shows another session is set aside', () => {
    const views = { main: { root: row('a', 'b'), shown: true } };
    expect(fixViews(views, tabs, spaceOf, 'main', 'c').main?.shown).toBe(false);
    expect(fixViews(views, tabs, spaceOf, 'pro', 'p')).toBe(views);
  });
});
