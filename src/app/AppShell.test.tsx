import { invoke } from '@tauri-apps/api/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { AppShell } from '@/app/AppShell';
import type { ConfigErrorDto } from '@/ipc/errors';
import type { Settings } from '@/ipc/generated/settings';
import type { Platform } from '@/ipc/app';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { defaultSettings } from '@/test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
const showWindow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    show: showWindow,
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => undefined)),
    onCloseRequested: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));

interface Backend {
  settings?: Settings;
  platform?: Platform;
  readOnly?: boolean;
  error?: ConfigErrorDto | null;
}

function mockBackend({
  settings = defaultSettings,
  platform = 'windows',
  readOnly = false,
  error = null,
}: Backend = {}) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    switch (cmd) {
      case 'settings_get':
        return Promise.resolve({ settings, readOnly, error });
      case 'app_info':
        return Promise.resolve({ version: '0.1.0', platform });
      case 'workspace_load':
        return Promise.resolve(null);
      case 'workspace_save':
        return Promise.resolve();
      case 'profiles_list':
        return Promise.resolve([]);
      case 'settings_update':
        return Promise.resolve(settings);
      default:
        return Promise.reject(new Error(`unexpected command ${cmd} ${JSON.stringify(args)}`));
    }
  });
}

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useSettings.setState({ settings: null, readOnly: false, error: null });
  useUi.setState({ settingsOpen: false, paletteOpen: false });
});

test('the main window has the rail, no tab bar, and the welcome screen', async () => {
  mockBackend();
  render(<App />);
  expect(await screen.findByRole('banner')).toHaveTextContent('Tilde');
  const rail = screen.getByRole('complementary', { name: 'Barre latérale' });
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(within(rail).getByRole('button', { name: 'Nouvelle session' })).toBeInTheDocument();
  expect(within(rail).getByText('Aucune connexion dans cet espace.')).toBeInTheDocument();
  expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
});

test('the quake window keeps its tab bar and has no rail', () => {
  render(
    <AppShell
      settings={defaultSettings}
      appInfo={{ version: '0.1.0', platform: 'windows' }}
      mode="quake"
    />,
  );
  expect(screen.getByRole('tablist')).toBeInTheDocument();
  expect(screen.queryByRole('complementary')).toBeNull();
});

test('shows the hidden window once the shell is ready, without animation frames', async () => {
  // A hidden WebView2 never runs requestAnimationFrame callbacks.
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  showWindow.mockClear();
  mockBackend();
  render(<App />);
  await screen.findByRole('banner');
  await vi.waitFor(() => {
    expect(showWindow).toHaveBeenCalledOnce();
  });
  raf.mockRestore();
});

test('a failing backend still shows the window with an error screen', async () => {
  showWindow.mockClear();
  vi.mocked(invoke).mockImplementation((cmd: string) =>
    cmd === 'settings_get'
      ? Promise.reject(new Error('backend down'))
      : new Promise(() => undefined),
  );
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tilde n’a pas pu démarrer');
  expect(screen.getByRole('alert')).toHaveTextContent('backend down');
  await vi.waitFor(() => {
    expect(showWindow).toHaveBeenCalled();
  });
});

test('sidebar moves to the right when sidebarPosition is right', async () => {
  mockBackend({
    settings: {
      ...defaultSettings,
      appearance: { ...defaultSettings.appearance, sidebarPosition: 'right' },
    },
  });
  render(<App />);
  const sidebar = await screen.findByRole('complementary', { name: 'Barre latérale' });
  expect(sidebar).toHaveAttribute('data-side', 'right');
  const main = screen.getByRole('main');
  // The sidebar comes after the main area in document order.
  expect(main.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('ui font size and density drive the root font size', async () => {
  mockBackend({
    settings: {
      ...defaultSettings,
      appearance: { ...defaultSettings.appearance, uiFontSize: 15, density: 'compact' },
    },
  });
  render(<App />);
  await screen.findByRole('banner');
  const root = document.documentElement;
  expect(root.dataset.density).toBe('compact');
  expect(root.style.getPropertyValue('--tilde-ui-font-size')).toBe('15px');
});

test('window controls hidden on macos', async () => {
  mockBackend({ platform: 'macos' });
  render(<App />);
  await screen.findByRole('banner');
  expect(screen.queryByRole('button', { name: 'Fermer' })).not.toBeInTheDocument();
});

test('window controls shown on windows', async () => {
  mockBackend({ platform: 'windows' });
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Fermer' })).toBeInTheDocument();
});

test('quick settings sends minimal patch', async () => {
  mockBackend();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Réglages' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: 'Clair' }));
  expect(invoke).toHaveBeenCalledWith('settings_update', {
    patch: { appearance: { colorScheme: 'light' } },
  });
});

test('read-only banner disables controls', async () => {
  mockBackend({
    readOnly: true,
    error: { kind: 'parse', message: 'EOF', line: 3, column: 5 },
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Réglages' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('alert')).toHaveTextContent('ligne 3, colonne 5');
  expect(within(dialog).getByRole('radio', { name: 'Clair' })).toBeDisabled();
});
