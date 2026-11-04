// The system's permission to notify: a refusal is asked again, a yes is kept.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { notifyDesktop } from './notify';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(), UserAttentionType: {} }));

test('a permission given later in the system settings counts without restarting Tilde', async () => {
  vi.mocked(isPermissionGranted).mockResolvedValue(false);
  vi.mocked(requestPermission).mockResolvedValue('denied');
  await notifyDesktop('demo-server', 'first');
  expect(sendNotification).not.toHaveBeenCalled();

  vi.mocked(isPermissionGranted).mockResolvedValue(true);
  await notifyDesktop('demo-server', 'second');
  expect(sendNotification).toHaveBeenCalledWith({ title: 'demo-server', body: 'second' });

  // Granted once, it is not asked again.
  vi.mocked(isPermissionGranted).mockClear();
  await notifyDesktop('demo-server', 'third');
  expect(isPermissionGranted).not.toHaveBeenCalled();
  expect(sendNotification).toHaveBeenCalledTimes(2);
});
