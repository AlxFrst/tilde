import type { ConnectionsFile } from '@/ipc/connections';
import { launchTakeConnection, launchTakeDir, onOpenConnection, onOpenDir } from '@/ipc/launch';
import type { ResolvedProfile } from '@/ipc/profiles';
import { blankConnection, useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { leaves } from '@/workspace/tree';
import { startLaunchHandling } from './launch';

vi.mock('@/ipc/launch', () => ({
  launchTakeDir: vi.fn(() => Promise.resolve(null)),
  launchTakeConnection: vi.fn(() => Promise.resolve(null)),
  onOpenDir: vi.fn(() => Promise.resolve(() => undefined)),
  onOpenConnection: vi.fn(() => Promise.resolve(() => undefined)),
}));

const profile: ResolvedProfile = {
  id: 'pwsh',
  name: 'PowerShell',
  command: 'pwsh',
  args: [],
  cwd: null,
  env: {},
  icon: 'powershell',
  color: null,
  source: 'detected',
};

const connections: ConnectionsFile = {
  version: 1,
  spaces: [],
  folders: [],
  connections: [blankConnection({ id: 'c1', name: 'Prod', host: 'demo-server' })],
  recents: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useConnections.setState({ file: connections, loaded: true });
  vi.mocked(launchTakeDir).mockResolvedValue(null);
  vi.mocked(launchTakeConnection).mockResolvedValue(null);
});

const panels = () =>
  useWorkspace.getState().tabs.flatMap((t) => leaves(t.root).map((l) => l.panel));

test('a folder Tilde was started on opens a terminal there', async () => {
  vi.mocked(launchTakeDir).mockResolvedValue('D:/projets/site');
  startLaunchHandling();
  await vi.waitFor(() => {
    expect(panels()).toEqual([
      expect.objectContaining({ kind: 'terminal', profileId: 'pwsh', cwd: 'D:/projets/site' }),
    ]);
  });
});

test('a folder sent by a second launch opens a new tab, and nothing opens otherwise', async () => {
  vi.mocked(launchTakeDir).mockResolvedValue(null);
  let send: ((dir: string) => void) | undefined;
  vi.mocked(onOpenDir).mockImplementation((h) => {
    send = h;
    return Promise.resolve(() => undefined);
  });
  startLaunchHandling();
  await Promise.resolve();
  expect(panels()).toEqual([]);
  send?.('C:/Users/me');
  expect(panels()).toEqual([expect.objectContaining({ cwd: 'C:/Users/me' })]);
  expect(useWorkspace.getState().activeTabId).toBe(useWorkspace.getState().tabs[0]?.id);
});

/** Hands over what `onOpenConnection` would receive from a later launch. */
function listenForConnections(): (key: string) => void {
  let send: ((key: string) => void) | undefined;
  vi.mocked(onOpenConnection).mockImplementation((h) => {
    send = h;
    return Promise.resolve(() => undefined);
  });
  startLaunchHandling();
  return (key) => {
    send?.(key);
  };
}

const shownTab = () => {
  const { tabs, activeTabId } = useWorkspace.getState();
  return tabs.find((t) => t.id === activeTabId);
};

test('a connection Tilde was started on opens once the saved connections are loaded', async () => {
  useConnections.setState({ file: { ...connections, connections: [] }, loaded: false });
  vi.mocked(launchTakeConnection).mockResolvedValue('conn:c1');
  startLaunchHandling();
  await vi.waitFor(() => {
    expect(launchTakeConnection).toHaveBeenCalled();
  });
  await Promise.resolve();
  expect(panels()).toEqual([]);
  useConnections.setState({ file: connections, loaded: true });
  expect(panels()).toEqual([
    expect.objectContaining({ kind: 'ssh', target: 'demo-server', connectionId: 'c1' }),
  ]);
  expect(shownTab()?.pinnedConnectionId).toBe('c1');
});

test('a connection sent by a later launch opens in this window, as the palette opens it', () => {
  const send = listenForConnections();
  expect(panels()).toEqual([]);
  send('ssh:root@example.com');
  expect(panels()).toEqual([
    expect.objectContaining({ kind: 'ssh', target: 'root@example.com', connectionId: null }),
  ]);
  // A saved connection already open is shown again, not opened twice.
  send('conn:c1');
  send('conn:c1');
  expect(panels()).toHaveLength(2);
  expect(shownTab()?.pinnedConnectionId).toBe('c1');
});

test('a key with nothing behind it opens nothing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const send = listenForConnections();
  send('conn:deleted');
  send('other:x');
  expect(panels()).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
