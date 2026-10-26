import { sftpSwitchUser } from '@/ipc/sftp';
import { useSftpUsers } from './sftpUsers';

vi.mock('@/ipc/sftp', async (orig) => ({
  ...(await orig<typeof import('@/ipc/sftp')>()),
  sftpSwitchUser: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.mocked(sftpSwitchUser).mockReset();
  useSftpUsers.setState({ bySession: {}, switching: {} });
});

test('one switch at a time per session: a second one is ignored while the first runs', async () => {
  let finish: (v: { login: string; user: string | null }) => void = () => undefined;
  vi.mocked(sftpSwitchUser).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = useSftpUsers.getState().switchTo(4, 'root');
  expect(useSftpUsers.getState().switching[4]).toBe(true);
  expect(await useSftpUsers.getState().switchTo(4, 'root')).toBe(false);
  expect(sftpSwitchUser).toHaveBeenCalledTimes(1);
  finish({ login: 'me', user: 'root' });
  expect(await first).toBe(true);
  expect(useSftpUsers.getState().switching[4]).toBe(false);
  expect(useSftpUsers.getState().bySession[4]?.user).toBe('root');
});
