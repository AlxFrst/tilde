import { replyPrompt, type SshPrompt } from '@/ipc/ssh';
import { statusTone, useSsh } from './ssh';

vi.mock('@/ipc/ssh', () => ({ replyPrompt: vi.fn(() => Promise.resolve(true)) }));

const ssh = () => useSsh.getState();

const secret = (id: number): SshPrompt => ({
  id,
  kind: 'secret',
  secret: 'password',
  keyPath: null,
  target: 'a@h',
  attempt: 1,
  canRemember: true,
});

beforeEach(() => {
  useSsh.setState({ states: {}, prompts: [], quickConnectOpen: false, tunnels: null });
  vi.mocked(replyPrompt).mockClear();
});

test('ssh state events update the pane status', () => {
  ssh().setState('leaf', { kind: 'connecting', hop: 'bastion 1/2 (b1)' });
  expect(statusTone(ssh().states.leaf)).toBe('busy');
  ssh().setState('leaf', { kind: 'ready' });
  expect(statusTone(ssh().states.leaf)).toBe('ok');
  ssh().setState('leaf', { kind: 'lost', reason: 'connexion perdue' });
  expect(statusTone(ssh().states.leaf)).toBe('bad');
  ssh().setState('leaf', { kind: 'reconnecting', attempt: 1, inSecs: 1 });
  expect(statusTone(ssh().states.leaf)).toBe('busy');
  ssh().clear('leaf');
  expect(statusTone(ssh().states.leaf)).toBeNull();
});

test('prompts queue up and an answer goes to the backend', () => {
  ssh().ask(secret(1));
  ssh().ask(secret(2));
  expect(ssh().prompts.map((p) => p.id)).toEqual([1, 2]);
  ssh().answer(1, { kind: 'secret', value: 'pw', remember: false });
  expect(replyPrompt).toHaveBeenCalledWith(1, { kind: 'secret', value: 'pw', remember: false });
  expect(ssh().prompts.map((p) => p.id)).toEqual([2]);
  ssh().dismiss(2);
  expect(ssh().prompts).toEqual([]);
});
