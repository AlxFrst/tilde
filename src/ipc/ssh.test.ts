import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { addForward, isValidTarget, onPrompts, replyPrompt, type SshPrompt } from './ssh';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: (e: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

beforeEach(() => {
  handlers.clear();
  vi.mocked(invoke).mockReset();
});

test('prompt replies and forwards use the command argument names of the backend', async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  await replyPrompt(3, { kind: 'secret', value: 'pw', remember: false });
  expect(invoke).toHaveBeenCalledWith('ssh_prompt_reply', {
    id: 3,
    reply: { kind: 'secret', value: 'pw', remember: false },
  });
  const spec = {
    kind: 'local',
    bind: '127.0.0.1',
    listenPort: 0,
    host: 'db',
    port: 5432,
  } as const;
  await addForward(7, spec);
  expect(invoke).toHaveBeenCalledWith('ssh_forward_add', { sessionId: 7, spec });
});

test('onPrompts delivers questions and dismissals', async () => {
  const asked = vi.fn();
  const dismissed = vi.fn();
  const off = await onPrompts(asked, dismissed);
  expect(listen).toHaveBeenCalledTimes(2);
  const prompt: SshPrompt = {
    id: 1,
    kind: 'keyboardInteractive',
    target: 'a@h',
    name: '',
    instructions: '',
    questions: [{ text: 'Code:', echo: true }],
  };
  handlers.get('ssh://prompt')?.({ payload: prompt });
  handlers.get('ssh://prompt-dismissed')?.({ payload: 1 });
  expect(asked).toHaveBeenCalledWith(prompt);
  expect(dismissed).toHaveBeenCalledWith(1);
  off();
  expect(handlers.size).toBe(0);
});

test('isValidTarget accepts aliases and user@host:port, nothing else', () => {
  for (const ok of ['prod', 'root@db.example', 'db:2222', 'me@[::1]:22']) {
    expect(isValidTarget(ok)).toBe(true);
  }
  for (const bad of ['', '  ', 'a b', 'a,b', 'host:port', 'host:99999', '@host', 'user@']) {
    expect(isValidTarget(bad)).toBe(false);
  }
});
