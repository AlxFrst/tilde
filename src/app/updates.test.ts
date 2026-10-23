import { toast } from 'sonner';
import { updateCheck, updateInstall } from '@/ipc/updates';
import { confirmClose } from './closeGuard';
import { checkForUpdates, DAY_MS, shouldAutoCheck } from './updates';

vi.mock('@/ipc/updates', () => ({
  updateCheck: vi.fn(),
  updateInstall: vi.fn(() => Promise.resolve()),
  onUpdateProgress: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock('./closeGuard', () => ({ confirmClose: vi.fn(() => Promise.resolve(true)) }));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'id'),
    dismiss: vi.fn(),
  });
  return { toast };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test('checks at most once a day, only when enabled', () => {
  const now = 10 * DAY_MS;
  expect(shouldAutoCheck(false, null, now)).toBe(false);
  expect(shouldAutoCheck(true, null, now)).toBe(true);
  expect(shouldAutoCheck(true, now - DAY_MS + 60_000, now)).toBe(false);
  expect(shouldAutoCheck(true, now - DAY_MS - 60_000, now)).toBe(true);
  // A clock set back does not block checks forever.
  expect(shouldAutoCheck(true, now + 5 * DAY_MS, now)).toBe(true);
});

test('a failed automatic check stays silent, a manual one says why', async () => {
  vi.mocked(updateCheck).mockRejectedValue('réseau indisponible');
  await checkForUpdates({ manual: false });
  expect(toast.error).not.toHaveBeenCalled();
  await checkForUpdates({ manual: true });
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('réseau indisponible'));

  vi.mocked(updateCheck).mockResolvedValue(null);
  await checkForUpdates({ manual: false });
  expect(toast.success).not.toHaveBeenCalled();
  await checkForUpdates({ manual: true });
  expect(toast.success).toHaveBeenCalledWith('Tilde est à jour.');
});

test('installing asks first when sessions or editors would be lost', async () => {
  vi.mocked(updateCheck).mockResolvedValue({ version: '0.2.0', notes: null, date: null });
  await checkForUpdates({ manual: false });
  const [message, options] = vi.mocked(toast).mock.calls[0] as unknown as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
  expect(message).toContain('0.2.0');
  expect(options.action.label).toBe('Mettre à jour');

  vi.mocked(confirmClose).mockResolvedValueOnce(false);
  options.action.onClick();
  await vi.waitFor(() => {
    expect(confirmClose).toHaveBeenCalledTimes(1);
  });
  expect(updateInstall).not.toHaveBeenCalled();

  options.action.onClick();
  await vi.waitFor(() => {
    expect(updateInstall).toHaveBeenCalledTimes(1);
  });
});
