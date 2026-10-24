import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerBuiltins } from '@/commands/builtin';
import type { ConnectionsFile } from '@/ipc/connections';
import { monitorRemote } from '@/ipc/monitor';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useSettings } from '@/stores/settings';
import { loadRailHidden, useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { compileBindings, DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import { Rail } from '../rail/Rail';
import { useShortcuts } from '../useShortcuts';
import { Peek } from './Peek';
import { SessionHeader } from './SessionHeader';

vi.mock('@/ipc/monitor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/monitor')>()),
  monitorRemote: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@/ipc/session', () => ({ isSessionBusy: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));

const demo = blankConnection({ id: 'c1', name: 'demo-server', host: 'demo' });
const file: ConnectionsFile = {
  version: 1,
  spaces: [],
  folders: [],
  connections: [demo],
  recents: [],
};

function Content() {
  useShortcuts();
  return (
    <>
      <SessionHeader platform="windows" />
      <div style={{ position: 'relative' }}>
        <Peek />
      </div>
    </>
  );
}

const ws = () => useWorkspace.getState();
const kinds = () => ws().tabs.flatMap((t) => leaves(t.root).map((l) => l.panel.kind));
const peek = () => screen.queryByRole('region', { name: /Moniteur · demo-server/ });
let stopCommands: () => void = () => undefined;

beforeAll(() => {
  registerCorePanels();
});
beforeEach(() => {
  useConnections.setState({ file, loaded: true });
  setSpaceResolver(makeSpaceResolver(file));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useKeybindings.setState({
    effective: { ...DEFAULT_KEYBINDINGS },
    table: compileBindings(DEFAULT_KEYBINDINGS),
  });
  useUi.setState({ peek: null, railHidden: false });
  stopCommands = registerBuiltins();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => {
  stopCommands();
  setSpaceResolver(defaultSpaceResolver);
});

test('the monitor opens as a peek over the session', async () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<Content />);
  await userEvent.click(screen.getByRole('button', { name: 'Moniteur' }));
  expect(peek()).toBeInTheDocument();
  expect(kinds()).toEqual(['ssh']);
  expect(screen.getByRole('button', { name: 'Moniteur' })).toHaveAttribute('aria-pressed', 'true');
  expect(monitorRemote).not.toHaveBeenCalledWith(-1);
});

test('dock turns the peek into a pane', async () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<Content />);
  await userEvent.click(screen.getByRole('button', { name: 'Moniteur' }));
  await userEvent.click(
    within(peek() as HTMLElement).getByRole('button', { name: 'Ancrer à droite' }),
  );
  expect(peek()).toBeNull();
  expect(kinds()).toEqual(['ssh', 'monitor']);
});

test('escape closes the peek', async () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<Content />);
  await userEvent.click(screen.getByRole('button', { name: 'Moniteur' }));
  await userEvent.keyboard('{Escape}');
  expect(peek()).toBeNull();
});

test('closing the ssh session closes its peek', async () => {
  const t = ws().openPinned('c1', 'demo', 'main');
  render(<Content />);
  await userEvent.click(screen.getByRole('button', { name: 'Moniteur' }));
  act(() => {
    ws().closeTab(t);
  });
  expect(peek()).toBeNull();
  expect(useUi.getState().peek).toBeNull();
});

test('ctrl+shift+b hides the rail and the edge brings it back', async () => {
  function Shell() {
    useShortcuts();
    return <Rail side="left" width={280} onOpenSettings={() => undefined} />;
  }
  render(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: 'Masquer la barre latérale' }));
  expect(useUi.getState().railHidden).toBe(true);
  fireEvent.keyDown(window, { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true });
  expect(useUi.getState().railHidden).toBe(false);
});

test('the hidden state survives a reload and a blocked storage', () => {
  act(() => {
    useUi.getState().setRailHidden(true);
  });
  expect(loadRailHidden()).toBe(true);
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(loadRailHidden()).toBe(false);
  getItem.mockRestore();
});
