import { render, screen } from '@testing-library/react';
import { setLocale } from '@/i18n';
import { monitorLocal, monitorRemote, type Snapshot } from '@/ipc/monitor';
import { registerSession } from '@/terminal/sessionRegistry';
import type { MonitorPanel } from '@/workspace/types';
import MonitorPane from './MonitorPane';

vi.mock('@/ipc/monitor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/monitor')>()),
  monitorLocal: vi.fn(),
  monitorRemote: vi.fn(),
}));

const GIB = 1024 ** 3;
const sample: Snapshot = {
  cpuPercent: 37.5,
  cores: 8,
  memTotal: 16 * GIB,
  memUsed: 6 * GIB,
  swapTotal: 2 * GIB,
  swapUsed: 0,
  load: [0.5, 0.4, 0.3],
  uptimeSecs: 3 * 86400 + 4 * 3600,
  netRxPerSec: 1024 * 1024,
  netTxPerSec: 2048,
  disks: [
    { mount: '/', total: 100 * GIB, used: 95 * GIB },
    { mount: '/srv', total: 500 * GIB, used: 100 * GIB },
  ],
  host: 'web-01',
};

function pane(state: MonitorPanel) {
  return (
    <MonitorPane
      tabId="t"
      leafId="m"
      state={state}
      active
      visible
      update={vi.fn()}
      close={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('shows CPU, memory, network and disks', async () => {
  vi.mocked(monitorLocal).mockResolvedValue(sample);
  render(pane({ kind: 'monitor', source: { kind: 'local' }, cwd: null, title: null }));
  expect(await screen.findByText('web-01')).toBeInTheDocument();
  expect(screen.getByText('38 %')).toBeInTheDocument();
  expect(screen.getByText(/8 cœurs/)).toBeInTheDocument();
  expect(screen.getByText(/6 Gio \/ 16 Gio/)).toBeInTheDocument();
  expect(screen.getByText(/1 Mio\/s/)).toBeInTheDocument();
  expect(screen.getByText('3 j 4 h')).toBeInTheDocument();
  const root = screen.getByRole('meter', { name: '/' });
  expect(root).toHaveAttribute('aria-valuenow', '95');
  expect(root).toHaveAttribute('data-full', 'true');
  expect(screen.getByRole('meter', { name: '/srv' })).toHaveAttribute('data-full', 'false');
});

test('a non-Linux server shows the explanation', async () => {
  registerSession('ssh-1', 9);
  vi.mocked(monitorRemote).mockRejectedValue({
    kind: 'notLinux',
    message: 'moniteur distant : Linux uniquement (/proc introuvable sur ce serveur)',
  });
  render(
    pane({
      kind: 'monitor',
      source: { kind: 'remote', linkedLeafId: 'ssh-1' },
      cwd: null,
      title: null,
    }),
  );
  expect(await screen.findByText(/Linux uniquement/)).toBeInTheDocument();
  expect(monitorRemote).toHaveBeenCalledWith(9);
});

test('reads in English, with English units', async () => {
  setLocale('en');
  vi.mocked(monitorLocal).mockResolvedValue(sample);
  render(pane({ kind: 'monitor', source: { kind: 'local' }, cwd: null, title: null }));
  expect(await screen.findByText('web-01')).toBeInTheDocument();
  expect(screen.getByText('CPU')).toBeInTheDocument();
  expect(screen.getByText('38%')).toBeInTheDocument();
  expect(screen.getByText('8 cores')).toBeInTheDocument();
  expect(screen.getByText(/6 GiB \/ 16 GiB/)).toBeInTheDocument();
  expect(screen.getByText(/1 MiB\/s/)).toBeInTheDocument();
  expect(screen.getByText('3 d 4 h')).toBeInTheDocument();
});
