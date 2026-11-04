// Closing a window: Rust is told the user closed it (it then forgets the window unless it
// was the last one), only once closing is confirmed.

import { windowClosing } from '@/ipc/window';
import { flushWorkspace } from '@/workspace/persistence';
import { confirmClose } from './closeGuard';
import { onCloseRequested } from './windowClose';

vi.mock('@/ipc/window', () => ({ windowClosing: vi.fn(() => Promise.resolve()) }));
vi.mock('@/workspace/persistence', () => ({ flushWorkspace: vi.fn() }));
vi.mock('./closeGuard', () => ({ confirmClose: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

test('a confirmed close saves the window and tells Rust the user closed it', async () => {
  vi.mocked(confirmClose).mockResolvedValue(true);
  const event = { preventDefault: vi.fn() };
  await onCloseRequested(event);
  expect(flushWorkspace).toHaveBeenCalled();
  expect(windowClosing).toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test('a close given up keeps the window and tells Rust nothing', async () => {
  vi.mocked(confirmClose).mockResolvedValue(false);
  const event = { preventDefault: vi.fn() };
  await onCloseRequested(event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(windowClosing).not.toHaveBeenCalled();
});

test('the window still closes if Rust cannot be told', async () => {
  vi.mocked(confirmClose).mockResolvedValue(true);
  vi.mocked(windowClosing).mockRejectedValueOnce(new Error('ipc'));
  const event = { preventDefault: vi.fn() };
  await onCloseRequested(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});
