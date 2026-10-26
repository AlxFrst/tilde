// A pane shown alone (« Agrandir ») until the session changes.

import { act, renderHook } from '@testing-library/react';
import { useRailHidden } from '@/app/AppShell';
import { registerBuiltins } from '@/commands/builtin';
import { runCommand } from '@/commands/registry';
import { DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { useUi } from '@/stores/ui';
import { leaves } from '@/workspace/tree';
import { useWorkspace, zoomedLeafOf } from './workspace';

const win = vi.hoisted(() => ({
  fullscreen: false,
  isFullscreen: vi.fn(() => Promise.resolve(win.fullscreen)),
  setFullscreen: vi.fn((on: boolean) => {
    win.fullscreen = on;
    return Promise.resolve();
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));

const ws = () => useWorkspace.getState();
const tab = () => {
  const t = ws().tabs[0];
  if (!t) throw new Error('no tab');
  return t;
};
const zoomed = () => zoomedLeafOf(tab(), ws().zoomed);

beforeEach(() => {
  useWorkspace.setState({ tabs: [], activeTabId: null, zoomed: {} });
  useUi.setState({ railHidden: false });
  ws().openTab('pwsh');
  ws().splitActive('row');
});

test('a pane is shown alone, then with the others again', () => {
  const [, second] = leaves(tab().root);
  ws().toggleZoom(tab().id, second?.id ?? '');
  expect(zoomed()).toBe(second?.id);
  ws().toggleZoom(tab().id, second?.id ?? '');
  expect(zoomed()).toBeNull();
});

test('zooming a pane that is not focused focuses it', () => {
  const [first] = leaves(tab().root);
  ws().toggleZoom(tab().id, first?.id ?? '');
  expect(tab().activeLeafId).toBe(first?.id);
  expect(zoomed()).toBe(first?.id);
});

test('a new pane or a focus change ends the zoom', () => {
  const [first, second] = leaves(tab().root);
  ws().toggleZoom(tab().id, second?.id ?? '');
  ws().splitActive('column');
  expect(zoomed()).toBeNull();

  ws().toggleZoom(tab().id, tab().activeLeafId);
  ws().focusLeaf(tab().id, first?.id ?? '');
  expect(zoomed()).toBeNull();
});

test('the Rail steps aside while the shown session has a pane alone', () => {
  const { result } = renderHook(() => useRailHidden());
  expect(result.current).toBe(false);
  act(() => {
    ws().toggleZoom(tab().id, tab().activeLeafId);
  });
  expect(result.current).toBe(true);
  act(() => {
    ws().toggleZoom(tab().id, tab().activeLeafId);
  });
  expect(result.current).toBe(false);
});

test('Ctrl+Shift+Enter shows the focused pane alone, and back', () => {
  expect(DEFAULT_KEYBINDINGS['pane.maximize']).toBe('Ctrl+Shift+Enter');
  const off = registerBuiltins();
  runCommand('pane.maximize');
  expect(zoomed()).toBe(tab().activeLeafId);
  runCommand('pane.maximize');
  expect(zoomed()).toBeNull();
  off();
});

test('F11 puts the window in full screen, and back', async () => {
  expect(DEFAULT_KEYBINDINGS['window.fullscreen']).toBe('F11');
  const off = registerBuiltins();
  runCommand('window.fullscreen');
  await vi.waitFor(() => {
    expect(win.setFullscreen).toHaveBeenLastCalledWith(true);
  });
  runCommand('window.fullscreen');
  await vi.waitFor(() => {
    expect(win.setFullscreen).toHaveBeenLastCalledWith(false);
  });
  off();
});

test('a zoom that ended never comes back by itself', () => {
  const [first, second] = leaves(tab().root);
  if (!first || !second) throw new Error();
  // Focus moves away, then back.
  ws().toggleZoom(tab().id, first.id);
  ws().focusLeaf(tab().id, second.id);
  ws().focusLeaf(tab().id, first.id);
  expect(zoomed()).toBeNull();
  // A pane opens then closes.
  ws().toggleZoom(tab().id, first.id);
  ws().splitActive('row');
  const added = tab().activeLeafId;
  ws().closeLeaf(tab().id, added);
  ws().focusLeaf(tab().id, first.id);
  expect(zoomed()).toBeNull();
  expect(ws().zoomed).toEqual({});
});

test('hiding the Rail while a pane is alone shows everything instead', () => {
  const off = registerBuiltins();
  ws().toggleZoom(tab().id, tab().activeLeafId);
  runCommand('sidebar.toggle');
  expect(zoomed()).toBeNull();
  expect(useUi.getState().railHidden).toBe(false);
  off();
});
