import { isSessionBusy } from '@/ipc/session';
import { useSettings } from '@/stores/settings';
import { defaultSettings } from '@/test/fixtures';
import { answerCloseGuard, confirmClose, useCloseGuard } from './closeGuard';

vi.mock('@/ipc/session', () => ({ isSessionBusy: vi.fn() }));

beforeEach(() => {
  vi.mocked(isSessionBusy).mockReset();
  useCloseGuard.setState({ pending: null });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
});

test('closing a busy pane asks for confirmation', async () => {
  vi.mocked(isSessionBusy).mockResolvedValue(true);
  const answer = confirmClose([1]);
  await vi.waitFor(() => {
    expect(useCloseGuard.getState().pending).not.toBeNull();
  });
  answerCloseGuard(false);
  await expect(answer).resolves.toBe(false);
  expect(useCloseGuard.getState().pending).toBeNull();
});

test('confirming closes', async () => {
  vi.mocked(isSessionBusy).mockResolvedValue(true);
  const answer = confirmClose([1, 2]);
  await vi.waitFor(() => {
    expect(useCloseGuard.getState().pending).not.toBeNull();
  });
  answerCloseGuard(true);
  await expect(answer).resolves.toBe(true);
});

test('idle sessions close without asking', async () => {
  vi.mocked(isSessionBusy).mockResolvedValue(false);
  await expect(confirmClose([1, 2])).resolves.toBe(true);
  expect(useCloseGuard.getState().pending).toBeNull();
});

test('a session that vanished counts as idle', async () => {
  vi.mocked(isSessionBusy).mockRejectedValue({ kind: 'notFound', message: 'gone' });
  await expect(confirmClose([1])).resolves.toBe(true);
});

test('confirmClose disabled skips the check', async () => {
  useSettings.setState({
    settings: {
      ...defaultSettings,
      terminal: { ...defaultSettings.terminal, confirmClose: false },
    },
  });
  await expect(confirmClose([1])).resolves.toBe(true);
  expect(isSessionBusy).not.toHaveBeenCalled();
});
