import { toast } from 'sonner';
import type { ResolvedProfile } from '@/ipc/profiles';
import { loadWorkspace, saveWorkspace } from '@/ipc/workspace';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { restoreWorkspace, startPersistence } from './persistence';
import { leaves } from './tree';

vi.mock('@/ipc/workspace', () => ({ loadWorkspace: vi.fn(), saveWorkspace: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const profile = (id: string): ResolvedProfile => ({
  id,
  name: id,
  command: id,
  args: [],
  cwd: null,
  env: {},
  icon: 'terminal',
  color: null,
  source: 'detected',
});

const ws = () => useWorkspace.getState();
const profileIds = () =>
  ws().tabs.flatMap((t) =>
    leaves(t.root).map((l) => (l.panel.kind === 'terminal' ? l.panel.profileId : l.panel.target)),
  );

beforeEach(() => {
  vi.mocked(loadWorkspace).mockReset();
  vi.mocked(saveWorkspace).mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.info).mockReset();
  useWorkspace.setState({ tabs: [], activeTabId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

test('saves debounced snapshots', () => {
  vi.useFakeTimers();
  const stop = startPersistence();
  ws().openTab('cmd');
  vi.advanceTimersByTime(50);
  ws().openTab('cmd');
  vi.advanceTimersByTime(50);
  ws().renameTab(ws().tabs[0]?.id ?? '', 'x');
  expect(saveWorkspace).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(saveWorkspace).toHaveBeenCalledTimes(1);
  expect(saveWorkspace).toHaveBeenCalledWith(ws().snapshot());
  stop();
  ws().openTab('cmd');
  vi.advanceTimersByTime(1000);
  expect(saveWorkspace).toHaveBeenCalledTimes(1);
});

test('restore replaces missing profiles with the default', async () => {
  ws().openTab('wsl:Gone');
  ws().splitActive('row', 'pwsh');
  const snap = ws().snapshot();
  useWorkspace.setState({ tabs: [], activeTabId: null });
  vi.mocked(loadWorkspace).mockResolvedValue(snap);
  await restoreWorkspace([profile('pwsh'), profile('cmd')], defaultSettings);
  expect(profileIds()).toEqual(['pwsh', 'pwsh']);
  expect(vi.mocked(toast.info).mock.calls[0]?.[0]).toContain('1');
});

test('restore disabled opens a fresh default tab', async () => {
  vi.mocked(loadWorkspace).mockResolvedValue({ version: 1, tabs: [], activeTabId: null });
  const settings = {
    ...defaultSettings,
    general: { ...defaultSettings.general, restoreSession: false },
  };
  await restoreWorkspace([profile('cmd')], settings);
  expect(loadWorkspace).not.toHaveBeenCalled();
  expect(profileIds()).toEqual(['cmd']);
});

test('empty or invalid snapshot opens a fresh default tab', async () => {
  for (const snap of [null, { version: 1, tabs: [], activeTabId: null }, { garbage: true }]) {
    useWorkspace.setState({ tabs: [], activeTabId: null });
    vi.mocked(loadWorkspace).mockResolvedValue(snap);
    await restoreWorkspace([profile('cmd')], defaultSettings);
    expect(profileIds()).toEqual(['cmd']);
  }
});

test('the configured default profile is used', async () => {
  vi.mocked(loadWorkspace).mockResolvedValue(null);
  const settings = {
    ...defaultSettings,
    terminal: { ...defaultSettings.terminal, defaultProfile: 'wsl:Ubuntu' },
  };
  await restoreWorkspace([profile('cmd'), profile('wsl:Ubuntu')], settings);
  expect(profileIds()).toEqual(['wsl:Ubuntu']);
});

test('no shell detected leaves the welcome screen', async () => {
  vi.mocked(loadWorkspace).mockResolvedValue(null);
  await restoreWorkspace([], defaultSettings);
  expect(ws().tabs).toEqual([]);
});

test('a failing load still opens a default tab', async () => {
  vi.mocked(loadWorkspace).mockRejectedValue(new Error('io'));
  await restoreWorkspace([profile('cmd')], defaultSettings);
  expect(profileIds()).toEqual(['cmd']);
});
