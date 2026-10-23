import type { ConnectionsView } from '@/ipc/connections';
import { useConnections } from './connections';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, h: (e: { payload: unknown }) => void) => {
    handlers.set(name, h);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));
const empty: ConnectionsView = {
  file: { version: 1, folders: [], connections: [], recents: [] },
  readOnly: false,
  error: null,
};
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => Promise.resolve(cmd === 'ssh_hosts' ? [] : empty)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

test('store applies connections://changed and exposes read-only errors', async () => {
  const off = await useConnections.getState().init();
  expect(useConnections.getState().loaded).toBe(true);
  const next: ConnectionsView = {
    file: {
      ...empty.file,
      connections: [
        {
          id: 'a',
          name: 'A',
          host: 'h',
          port: null,
          user: null,
          identityFile: null,
          proxyJump: null,
          forwardAgent: null,
          folderId: null,
          color: null,
          icon: null,
          tags: [],
          favorite: false,
        },
      ],
    },
    readOnly: true,
    error: { kind: 'parse', message: 'EOF', line: 3, column: 1 },
  };
  handlers.get('connections://changed')?.({ payload: next });
  const s = useConnections.getState();
  expect(s.file.connections.map((c) => c.id)).toEqual(['a']);
  expect(s.readOnly).toBe(true);
  expect(s.error?.line).toBe(3);
  off();
  expect(handlers.size).toBe(0);
});
