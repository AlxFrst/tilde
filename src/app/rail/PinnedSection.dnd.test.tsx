// Dragging a saved connection between folders and out of them. jsdom has no layout, so
// the rectangles dnd-kit measures are given by hand.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MAIN_SPACE } from '@/connections/spaces';
import type { Connection } from '@/ipc/connections';
import { upsertConnection } from '@/ipc/connections';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { PinnedSection } from './PinnedSection';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve(c)),
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
