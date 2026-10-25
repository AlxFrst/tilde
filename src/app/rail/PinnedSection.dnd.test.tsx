// Dragging a saved connection between folders and out of them. jsdom has no layout, so
// the rectangles dnd-kit measures are given by hand.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MAIN_SPACE } from '@/connections/spaces';
import type { Connection } from '@/ipc/connections';
import { moveConnection, upsertConnection } from '@/ipc/connections';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { PinnedSection } from './PinnedSection';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve(c)),
  moveConnection: vi.fn(() => Promise.resolve()),
}));

const rects = new Map<Element, DOMRect>();

beforeEach(() => {
  vi.clearAllMocks();
  rects.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
  });
  useWorkspace.setState({ tabs: [], activeTabId: null, activeSpaceId: MAIN_SPACE.id });
  useConnections.setState({
    loaded: true,
    readOnly: false,
    file: {
      version: 1,
      spaces: [],
      folders: [{ id: 'f1', name: 'Prod', color: null, spaceId: null }],
      connections: [
        blankConnection({ id: 'c1', name: 'web', host: 'web.example', folderId: 'f1' }),
      ],
      recents: [],
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drags `el` by `dy` pixels with the pointer. */
async function drag(el: Element, dy: number) {
  const at = (y: number) => ({ clientX: 10, clientY: y, isPrimary: true, button: 0, pointerId: 1 });
  fireEvent.pointerDown(el, at(50));
  await act(async () => {
    fireEvent.pointerMove(el, at(60));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.pointerMove(el, at(50 + dy));
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    fireEvent.pointerUp(el, at(50 + dy));
    await Promise.resolve();
  });
}

test('dragging a connection out of its folder takes it to the root', async () => {
  render(<PinnedSection />);
  rects.set(screen.getByRole('group', { name: 'Épinglés' }), new DOMRect(0, 0, 280, 400));
  rects.set(screen.getByRole('group', { name: 'Prod' }), new DOMRect(0, 0, 280, 100));
  const row = screen.getByRole('button', { name: /^web/ });
  rects.set(row, new DOMRect(0, 40, 280, 30));

  await drag(row, 250);

  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'c1', folderId: null }),
  );
});

test('dragging a connection onto another folder moves it there', async () => {
  const { file } = useConnections.getState();
  useConnections.setState({
    file: {
      ...file,
      folders: [...file.folders, { id: 'f2', name: 'Staging', color: null, spaceId: null }],
    },
  });
  render(<PinnedSection />);
  rects.set(screen.getByRole('group', { name: 'Épinglés' }), new DOMRect(0, 0, 280, 400));
  rects.set(screen.getByRole('group', { name: 'Prod' }), new DOMRect(0, 0, 280, 100));
  rects.set(screen.getByRole('group', { name: 'Staging' }), new DOMRect(0, 200, 280, 100));
  const row = screen.getByRole('button', { name: /^web/ });
  rects.set(row, new DOMRect(0, 40, 280, 30));

  await drag(row, 180);

  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'c1', folderId: 'f2' }),
  );
});

describe('reordering', () => {
  beforeEach(() => {
    useConnections.setState({
      file: {
        version: 1,
        spaces: [],
        folders: [{ id: 'f1', name: 'Prod', color: null, spaceId: null }],
        connections: [
          blankConnection({ id: 'a', name: 'alpha', host: 'a.example' }),
          blankConnection({ id: 'b', name: 'beta', host: 'b.example' }),
          blankConnection({ id: 'c1', name: 'web', host: 'web.example', folderId: 'f1' }),
        ],
        recents: [],
      },
    });
  });

  function layout() {
    rects.set(screen.getByRole('group', { name: 'Épinglés' }), new DOMRect(0, 0, 280, 400));
    rects.set(screen.getByRole('group', { name: 'Prod' }), new DOMRect(0, 200, 280, 100));
    const row = (name: RegExp) => screen.getByRole('button', { name });
    rects.set(row(/^alpha/), new DOMRect(0, 40, 280, 30));
    rects.set(row(/^beta/), new DOMRect(0, 80, 280, 30));
    rects.set(row(/^web/), new DOMRect(0, 240, 280, 30));
    return row;
  }

  test('dropping a row on the one above puts it before', async () => {
    render(<PinnedSection />);
    const row = layout();
    await drag(row(/^beta/), 5); // the pointer ends at y 55, on alpha
    expect(moveConnection).toHaveBeenCalledWith('b', null, 'a');
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  test('dropping a row on the one below puts it after', async () => {
    render(<PinnedSection />);
    const row = layout();
    await drag(row(/^alpha/), 45); // y 95, on beta, the last one
    expect(moveConnection).toHaveBeenCalledWith('a', null, null);
  });

  test('dropping a row from a folder on a root row moves it out, before that row', async () => {
    render(<PinnedSection />);
    const row = layout();
    await drag(row(/^web/), 0 - 5); // y 45, on alpha
    expect(moveConnection).toHaveBeenCalledWith('c1', null, 'a');
  });
});
