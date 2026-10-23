import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { editResolve, type TransferInfo } from '@/ipc/sftp';
import { useTransfers } from '@/stores/transfers';
import { TransfersButton } from './TransfersButton';

let emit: (t: TransferInfo) => void = () => undefined;
vi.mock('@/ipc/sftp', async (orig) => ({
  ...(await orig<typeof import('@/ipc/sftp')>()),
  transfersList: vi.fn(() => Promise.resolve([])),
  onTransfer: vi.fn((cb: (t: TransferInfo) => void) => {
    emit = cb;
    return Promise.resolve(() => undefined);
  }),
  editResolve: vi.fn(() => Promise.resolve()),
  transferCancel: vi.fn(() => Promise.resolve()),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

/** Events reach the store in batches. */
const flushBatch = () => new Promise((r) => setTimeout(r, 150));

const t = (id: number, extra: Partial<TransferInfo> = {}): TransferInfo => ({
  id,
  session: 1,
  direction: 'download',
  local: `C:/Users/me/Downloads/f${String(id)}.bin`,
  remote: `/srv/f${String(id)}.bin`,
  total: 100,
  done: 0,
  bytesPerSec: 0,
  state: { kind: 'queued' },
  ...extra,
});

beforeEach(async () => {
  useTransfers.setState({ transfers: {} });
  await useTransfers.getState().init();
});

test('transfer events update the list and the badge count', async () => {
  render(<TransfersButton />);
  expect(screen.queryByRole('button', { name: /Transferts/ })).toBeNull();
  await act(async () => {
    emit(t(1, { state: { kind: 'running' }, done: 50, bytesPerSec: 10 }));
    emit(t(2));
    await flushBatch();
  });
  const button = screen.getByRole('button', { name: 'Transferts : 2 en cours' });
  await userEvent.click(button);
  expect(await screen.findByText('f1.bin')).toBeInTheDocument();
  expect(screen.getByText('50 o / 100 o — 10 o/s — 5 s')).toBeInTheDocument();
  await act(async () => {
    emit(t(1, { state: { kind: 'done' }, done: 100 }));
    await flushBatch();
  });
  expect(screen.getByRole('button', { name: 'Transferts : 1 en cours' })).toBeInTheDocument();
});

test('a conflict offers overwrite or download', async () => {
  render(<TransfersButton />);
  await act(async () => {
    emit(
      t(9, { direction: 'upload', state: { kind: 'conflict', message: 'modifié sur le serveur' } }),
    );
    await flushBatch();
  });
  await userEvent.click(screen.getByRole('button', { name: /Transferts/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Écraser' }));
  expect(editResolve).toHaveBeenCalledWith(9, true);
  await userEvent.click(screen.getByRole('button', { name: 'Prendre la version du serveur' }));
  expect(editResolve).toHaveBeenCalledWith(9, false);
});
