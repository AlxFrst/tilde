// Events Rust sends to one window are listened to on that window only.

import { listen } from '@tauri-apps/api/event';
import { onQuakeError } from './window';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'window-2' }) }));

test('a Quake shortcut error shows in the window Rust sends it to, not in every window', async () => {
  const shown: string[] = [];
  await onQuakeError((m) => shown.push(m));
  expect(listen).toHaveBeenCalledWith('quake://error', expect.any(Function), {
    target: 'window-2',
  });
  const handler = vi.mocked(listen).mock.calls[0]?.[1];
  handler?.({ event: 'quake://error', id: 1, payload: 'taken' });
  expect(shown).toEqual(['taken']);
});
