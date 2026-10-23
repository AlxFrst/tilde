import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { monitorRemote, type Snapshot } from '@/ipc/monitor';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { registerSession, unregisterSession } from '@/terminal/sessionRegistry';
import { defaultSettings } from '@/test/fixtures';
import { leaves } from '@/workspace/tree';
import { ServerStatusBar } from './ServerStatusBar';

vi.mock('@/ipc/monitor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/monitor')>()),
  monitorRemote: vi.fn(),
}));

const GIB = 1024 ** 3;
const sample: Snapshot = {
  cpuPercent: 37.5,
  cores: 8,
  memTotal: 16 * GIB,
  memUsed: 6 * GIB,
  swapTotal: 0,
  swapUsed: 0,
  load: [0.5, 0.4, 0.3],
  uptimeSecs: 3600,
  netRxPerSec: 1024 * 1024,
  netTxPerSec: 2048,
  disks: [{ mount: '/', total: 100 * GIB, used: 58 * GIB }],
  host: 'web-01',
};

const update = vi.fn(() => Promise.resolve());

beforeEach(() => {
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null, update });
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  vi.mocked(monitorRemote).mockReset();
  update.mockClear();
});

afterEach(() => {
  unregisterSession('s');
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('shows the server’s CPU, memory, disk and network once its session is up', async () => {
  vi.mocked(monitorRemote).mockResolvedValue(sample);
  const { container } = render(<ServerStatusBar leafId="s" visible />);
  expect(container).toBeEmptyDOMElement();
  act(() => {
    registerSession('s', 7);
  });
  await flush();
  expect(monitorRemote).toHaveBeenCalledWith(7);
  const bar = screen.getByRole('status', { name: 'État du serveur' });
  expect(bar).toHaveTextContent('web-01');
  expect(bar).toHaveTextContent('38 %');
  expect(bar).toHaveTextContent('6 Gio / 16 Gio');
  expect(bar).toHaveTextContent('/ 58 %');
  expect(bar).toHaveTextContent('1 Mio/s');
});

test('stays out of the way on servers that are not Linux', async () => {
  vi.mocked(monitorRemote).mockRejectedValue({ kind: 'notLinux', message: 'pas Linux' });
  registerSession('s', 7);
  render(<ServerStatusBar leafId="s" visible />);
  await flush();
  expect(screen.queryByRole('status')).toBeNull();
});

test('is not polled when turned off or when the pane is hidden', async () => {
  vi.mocked(monitorRemote).mockResolvedValue(sample);
  registerSession('s', 7);
  const { rerender } = render(<ServerStatusBar leafId="s" visible={false} />);
  await flush();
  expect(monitorRemote).not.toHaveBeenCalled();

  useSettings.setState({
    settings: { ...defaultSettings, ssh: { ...defaultSettings.ssh, statusBar: false } },
  });
  rerender(<ServerStatusBar leafId="s" visible />);
  await flush();
  expect(monitorRemote).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});

test('opens the details, and can be hidden', async () => {
  vi.mocked(monitorRemote).mockResolvedValue(sample);
  const tab = useWorkspace.getState().openSshTab('prod');
  const sshLeaf = useWorkspace.getState().tabs[0]?.activeLeafId ?? '';
  registerSession(sshLeaf, 7);
  render(<ServerStatusBar leafId={sshLeaf} visible />);
  await flush();

  await userEvent.click(screen.getByRole('button', { name: 'Détails' }));
  const root = useWorkspace.getState().tabs.find((t) => t.id === tab)?.root;
  expect(root && leaves(root).map((l) => l.panel.kind)).toEqual(['ssh', 'monitor']);

  await userEvent.click(screen.getByRole('button', { name: 'Masquer le bandeau' }));
  expect(update).toHaveBeenCalledWith({ ssh: { statusBar: false } });
  unregisterSession(sshLeaf);
});
