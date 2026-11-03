// Where a session dragged from the Rail would land on the content, and what it says.

import { registerCorePanels } from '@/panels/core';
import { useWorkspace } from '@/stores/workspace';
import type { LabelNames } from './paneLabel';
import { previewFor, viewDropTarget } from './viewDrop';

const ws = () => useWorkspace.getState();
const names: LabelNames = { connectionName: () => null, profileName: () => null };
const area = document.createElement('main');
area.setAttribute('data-view-area', '');

beforeAll(() => {
  registerCorePanels();
  document.body.append(area);
});

let a = '';
let b = '';
beforeEach(() => {
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 0, 1000, 600));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
    views: {},
  });
  a = ws().openTab('cmd');
  ws().renameTab(a, 'alpha');
  b = ws().openTab('cmd');
  ws().renameTab(b, 'beta');
  ws().activateTab(a);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the drop target is the session under the pointer and the zone in it', () => {
  expect(viewDropTarget(1250, 300)).toMatchObject({ targetTabId: a, zone: 'right' });
  expect(viewDropTarget(800, 300)).toMatchObject({ targetTabId: a, zone: 'center' });
  expect(viewDropTarget(100, 300)).toBeNull();
});

test('in a view, the drop target is the slot under the pointer', () => {
  ws().placeInView(b, a, 'right');
  expect(viewDropTarget(1250, 300)).toMatchObject({ targetTabId: b, zone: 'right' });
  expect(viewDropTarget(350, 300)).toMatchObject({ targetTabId: a, zone: 'left' });
});

test('the preview says where the session goes', () => {
  const at = (x: number, y: number) => previewFor({ tabId: b }, viewDropTarget(x, y), names);
  expect(at(1250, 300)).toMatchObject({ label: 'À droite de alpha', bad: false });
  expect(at(1250, 300)?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  expect(at(350, 300)?.label).toBe('À gauche de alpha');
  expect(at(800, 20)?.label).toBe('Au-dessus de alpha');
  expect(at(800, 590)?.label).toBe('En dessous de alpha');
  expect(at(800, 300)?.label).toBe('À la place de alpha');
});

test('a session already in the view swaps in the centre; on itself nothing shows', () => {
  ws().placeInView(b, a, 'right');
  expect(previewFor({ tabId: b }, viewDropTarget(500, 300), names)?.label).toBe(
    'Échanger avec alpha',
  );
  expect(previewFor({ tabId: b }, viewDropTarget(1100, 300), names)).toBeNull();
});

test('a full view says so, in red', () => {
  const [c = '', d = '', e = ''] = ['c', 'd', 'e'].map(() => ws().openTab('cmd'));
  ws().activateTab(a);
  ws().placeInView(b, a, 'right');
  ws().placeInView(c, b, 'right');
  ws().placeInView(d, c, 'right');
  expect(previewFor({ tabId: e }, viewDropTarget(320, 300), names)).toMatchObject({
    label: '4 sessions au plus dans une vue',
    bad: true,
  });
});
