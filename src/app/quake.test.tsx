import { invoke } from '@tauri-apps/api/core';
import { render, renderHook, screen } from '@testing-library/react';
import App from '@/App';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { openDefaultTab } from './actions';
import { isQuakeWindow, useQuakeTabs } from './quake';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const events = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, h: (e: { payload: unknown }) => void) => {
    events.set(name, h);
    return Promise.resolve(() => events.delete(name));
  }),
}));
const win = vi.hoisted(() => ({
  label: 'quake',
  show: vi.fn(() => Promise.resolve()),
  hide: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onResized: vi.fn(() => Promise.resolve(() => undefined)),
  onCloseRequested: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
vi.mock('./actions', async (orig) => ({
  ...(await orig<typeof import('./actions')>()),
  openDefaultTab: vi.fn(),
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettings.setState({ settings: null, readOnly: false, error: null });
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'settings_get':
        return Promise.resolve({ settings: defaultSettings, readOnly: false, error: null });
      case 'app_info':
        return Promise.resolve({ version: '0.1.0', platform: 'windows' });
      case 'profiles_list':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`unexpected ${cmd}`));
    }
  });
});

test('isQuakeWindow reads the window label', () => {
  expect(isQuakeWindow('quake')).toBe(true);
  expect(isQuakeWindow('main')).toBe(false);
  expect(isQuakeWindow()).toBe(true);
});

test('quake window shows no sidebar and does not persist', async () => {
  render(<App mode="quake" />);
  expect(await screen.findByRole('tablist')).toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'Connexions' })).toBeNull();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).not.toContain('workspace_load');
  // Rust shows the Quake window on the shortcut; the page never shows itself.
  expect(win.show).not.toHaveBeenCalled();
  expect(openDefaultTab).toHaveBeenCalled();
});

test('closing the last tab hides the window and reopens a tab', () => {
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        title: 'pwsh',
        color: null,
        root: { kind: 'leaf', id: 'l1', panel: { kind: 'terminal', profileId: 'pwsh' } },
        activeLeafId: 'l1',
      },
    ] as never,
    activeTabId: 't1',
  });
  renderHook(() => {
    useQuakeTabs();
  });
  expect(win.hide).not.toHaveBeenCalled();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  // renderHook re-renders on store changes through the subscription.
  return vi.waitFor(() => {
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(openDefaultTab).toHaveBeenCalled();
  });
});

test('turning Quake off closes its tabs (and their sessions) before the window goes', async () => {
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        title: 'ssh',
        color: null,
        root: { kind: 'leaf', id: 'l1', panel: { kind: 'terminal', profileId: 'pwsh' } },
        activeLeafId: 'l1',
      },
    ] as never,
    activeTabId: 't1',
  });
  renderHook(() => {
    useQuakeTabs();
  });
  await vi.waitFor(() => {
    expect(events.has('quake://shutdown')).toBe(true);
  });
  events.get('quake://shutdown')?.({ payload: null });
  expect(useWorkspace.getState().tabs).toEqual([]);
  await vi.waitFor(() => {
    expect(win.destroy).toHaveBeenCalled();
  });
  // Shutting down is not « last tab closed »: no hide, no fresh tab.
  expect(win.hide).not.toHaveBeenCalled();
  expect(openDefaultTab).not.toHaveBeenCalled();
});
