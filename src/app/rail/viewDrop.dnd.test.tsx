// Dragging a session from « Aujourd'hui » onto the content. jsdom has no layout, so the
// rectangles dnd-kit and the drop target measure are given by hand.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { registerCorePanels } from '@/panels/core';
import { useUi } from '@/stores/ui';
import { shownView, useWorkspace } from '@/stores/workspace';
import { viewTabs } from '@/workspace/view';
import { TodaySection } from './TodaySection';

const rects = new Map<Element, DOMRect>();
const ws = () => useWorkspace.getState();
const shown = () => {
  const view = shownView(ws());
  return view ? viewTabs(view) : [];
};

beforeAll(() => {
  registerCorePanels();
});

let a = '';
let b = '';
beforeEach(() => {
  rects.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
  });
  useUi.setState({ viewDrop: null });
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

function setup() {
  render(
    <>
      <TodaySection />
      <main data-view-area data-testid="area" />
    </>,
  );
  rects.set(screen.getByTestId('area'), new DOMRect(300, 0, 1000, 600));
  const row = (name: string) => screen.getByRole('button', { name });
  rects.set(row('alpha'), new DOMRect(0, 40, 280, 30));
  rects.set(row('beta'), new DOMRect(0, 80, 280, 30));
  return row;
}

const at = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  isPrimary: true,
  button: 0,
  pointerId: 1,
});

/** Presses on `el` at (10, 95), moves to (x, y), and lets go unless `release` is false. */
async function drag(el: Element, x: number, y: number, release = true) {
  fireEvent.pointerDown(el, at(10, 95));
  await act(async () => {
    fireEvent.pointerMove(el, at(20, 95));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.pointerMove(el, at(x, y));
    await new Promise((r) => setTimeout(r, 20));
  });
  if (!release) return;
  await act(async () => {
    fireEvent.pointerUp(el, at(x, y));
    await Promise.resolve();
  });
}

test('dropping a Today session on the right edge of the content puts it beside the active one', async () => {
  const row = setup();
  await drag(row('beta'), 1250, 300);
  expect(shown()).toEqual([a, b]);
  expect(ws().activeTabId).toBe(b);
  expect(useUi.getState().viewDrop).toBeNull();
});

test('dropping it in the centre shows it in place of the active one', async () => {
  const row = setup();
  await drag(row('beta'), 800, 300);
  expect(shown()).toEqual([]);
  expect(ws().activeTabId).toBe(b);
});

test('while it is dragged over the content, the preview says where it goes', async () => {
  const row = setup();
  await drag(row('beta'), 1250, 300, false);
  expect(useUi.getState().viewDrop).toMatchObject({ label: 'À droite de alpha', bad: false });
});

test('dropping it back on the Rail reorders and leaves no preview', async () => {
  const row = setup();
  await drag(row('beta'), 10, 45);
  expect(ws().tabs.map((t) => t.id)).toEqual([b, a]);
  expect(shown()).toEqual([]);
  expect(useUi.getState().viewDrop).toBeNull();
});

test('Escape cancels the drop', async () => {
  const row = setup();
  await drag(row('beta'), 1250, 300, false);
  await act(async () => {
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await Promise.resolve();
  });
  expect(useUi.getState().viewDrop).toBeNull();
  fireEvent.pointerUp(row('beta'), at(1250, 300));
  expect(shown()).toEqual([]);
});
