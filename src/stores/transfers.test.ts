import { toast } from 'sonner';
import type { TransferInfo } from '@/ipc/sftp';
import { useTransfers } from './transfers';

let emit: (t: TransferInfo) => void = () => undefined;
vi.mock('@/ipc/sftp', () => ({
  transfersList: vi.fn(() => Promise.resolve([])),
  transferReveal: vi.fn(() => Promise.resolve()),
  onTransfer: vi.fn((cb: (t: TransferInfo) => void) => {
    emit = cb;
    return Promise.resolve(() => undefined);
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const t = (id: number, state: TransferInfo['state']): TransferInfo => ({
  id,
  session: 1,
  direction: 'upload',
  local: `/tmp/f${String(id)}`,
  remote: `/srv/f${String(id)}`,
  total: 1,
  done: 0,
  bytesPerSec: 0,
  state,
});

test('a burst of events is applied at once and failures are announced together', async () => {
  vi.useFakeTimers();
  useTransfers.setState({ transfers: {} });
  await useTransfers.getState().init();
  const renders = vi.fn();
  const off = useTransfers.subscribe(renders);
  for (let i = 1; i <= 500; i++) emit(t(i, { kind: 'queued' }));
  for (let i = 1; i <= 500; i++) emit(t(i, { kind: 'failed', message: 'connexion perdue' }));
  expect(renders).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(renders).toHaveBeenCalledTimes(1);
  expect(Object.keys(useTransfers.getState().transfers)).toHaveLength(500);
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('500 transferts ont échoué', {
    description: 'connexion perdue',
  });
  off();
  vi.useRealTimers();
});
