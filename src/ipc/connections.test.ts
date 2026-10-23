import { invoke } from '@tauri-apps/api/core';
import { removeFolder, setFavorite, upsertConnection } from './connections';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

test('commands use the backend argument names', async () => {
  const c = { id: '', name: 'a', host: 'h' } as Parameters<typeof upsertConnection>[0];
  await upsertConnection(c);
  expect(invoke).toHaveBeenCalledWith('connections_upsert', { connection: c });
  await setFavorite('x', true);
  expect(invoke).toHaveBeenCalledWith('connections_set_favorite', { id: 'x', favorite: true });
  await removeFolder('f');
  expect(invoke).toHaveBeenCalledWith('folders_remove', { id: 'f' });
});
