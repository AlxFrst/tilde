import { launchTakeDir, onOpenDir } from '@/ipc/launch';
import type { ResolvedProfile } from '@/ipc/profiles';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { leaves } from '@/workspace/tree';
import { startLaunchHandling } from './launch';

vi.mock('@/ipc/launch', () => ({
  launchTakeDir: vi.fn(),
  onOpenDir: vi.fn(() => Promise.resolve(() => undefined)),
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

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
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
