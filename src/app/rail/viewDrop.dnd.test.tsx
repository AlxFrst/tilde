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
  // A drag a test leaves going would still hear the next test's pointer.
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  });
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

// Carried sideways, the row used to widen the Rail's list, which dnd-kit then scrolled
// after it: the Rail slid away under the content and stayed there, and the drop missed.

/** The transform of the row's draggable wrapper. */
function moved(el: Element): string {
  for (let e: HTMLElement | null = el as HTMLElement; e; e = e.parentElement) {
    if (e.style.transform) return e.style.transform;
  }
  return '';
}

/** The Rail's scrolling list around « Aujourd'hui », `height` pixels of content tall. */
function setupInRail(height = 600) {
  render(
    <>
      <div data-testid="rail" style={{ overflowX: 'hidden', overflowY: 'auto' }}>
        <TodaySection />
      </div>
      <main data-view-area data-testid="area" />
    </>,
  );
  const rail = screen.getByTestId('rail');
  rects.set(rail, new DOMRect(0, 0, 290, 600));
  Object.defineProperty(rail, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(rail, 'scrollHeight', { configurable: true, value: height });
  rects.set(screen.getByTestId('area'), new DOMRect(300, 0, 1000, 600));
  const row = (name: string) => screen.getByRole('button', { name });
  rects.set(row('alpha'), new DOMRect(0, 40, 280, 30));
  rects.set(row('beta'), new DOMRect(0, 80, 280, 30));
  return { rail, row };
}

test('a row dragged over the content stays in its place in the Rail, and so do the others', async () => {
  const row = setup();
  // Down the content, far below the Rail's rows: the drop goes to the content, not the list.
  await drag(row('beta'), 1250, 500, false);
  expect(moved(row('beta'))).toBe('');
  expect(moved(row('alpha'))).toBe('');
});

test('back over the Rail, the row moves up and down its list again', async () => {
  const row = setup();
  await drag(row('beta'), 1250, 500, false);
  await act(async () => {
    fireEvent.pointerMove(row('beta'), at(100, 45));
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(moved(row('beta'))).toMatch(/^translate3d\(0px, -/);
});

test('the drop lands under the pointer even if the Rail scrolled meanwhile', async () => {
  const { rail, row } = setupInRail();
  await drag(row('beta'), 1250, 300, false);
  await act(async () => {
    Object.defineProperty(rail, 'scrollLeft', { configurable: true, value: 400 });
    fireEvent.scroll(rail);
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.pointerMove(row('beta'), at(1250, 300));
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    fireEvent.pointerUp(row('beta'), at(1250, 300));
    await Promise.resolve();
  });
  expect(shown()).toEqual([a, b]);
});

test('the Rail does not scroll under a row dragged over the content', async () => {
  const { rail, row } = setupInRail(2000);
  const scrollBy = vi.fn();
  rail.scrollBy = scrollBy;
  // The bottom of the window, as low as the Rail's bottom edge.
  await drag(row('beta'), 1250, 590, false);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(scrollBy).not.toHaveBeenCalled();
});

test('the Rail still scrolls under a row dragged along its bottom edge', async () => {
  const { rail, row } = setupInRail(2000);
  const scrollBy = vi.fn();
  rail.scrollBy = scrollBy;
  await drag(row('beta'), 100, 595, false);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(scrollBy).toHaveBeenCalledWith(0, expect.any(Number));
});
