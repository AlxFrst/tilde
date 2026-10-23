import { Channel, invoke } from '@tauri-apps/api/core';
import { openSession, writeSession } from './session';
import { pickDefaultProfile, type ResolvedProfile } from './profiles';

const channels: { onmessage: (m: unknown) => void }[] = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(function (this: { onmessage: (m: unknown) => void }) {
    this.onmessage = () => undefined;
    channels.push(this);
  }),
}));

beforeEach(() => {
  channels.length = 0;
  vi.mocked(invoke).mockReset();
});

test('writeSession sends raw bytes with the session header', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  await writeSession(7, 'é');
  // Compare bytes, not instances: jsdom's TextEncoder returns a Uint8Array from another realm.
  const [cmd, body, options] = vi.mocked(invoke).mock.calls[0] ?? [];
  expect(cmd).toBe('session_write');
  expect(Array.from(body as Uint8Array)).toEqual([0xc3, 0xa9]);
  expect(options).toEqual({ headers: { 'x-session-id': '7' } });
});

async function open() {
  vi.mocked(invoke).mockResolvedValue({ id: 1, profileId: 'cmd' });
  const onData = vi.fn();
  const onExit = vi.fn();
  await openSession({ profileId: 'cmd', cols: 80, rows: 24, onData, onExit });
  expect(Channel).toHaveBeenCalledTimes(2);
  const [output, events] = channels;
  if (!output || !events) throw new Error('channels not created');
  return { onData, onExit, output, events };
}

test('openSession forwards channel data as Uint8Array', async () => {
  const { onData, output } = await open();
  output.onmessage(new Uint8Array([104, 105]).buffer);
  expect(onData).toHaveBeenCalledWith(new Uint8Array([104, 105]));
});

test('openSession accepts number arrays from the channel', async () => {
  const { onData, output } = await open();
  output.onmessage([104, 105]);
  expect(onData).toHaveBeenCalledWith(new Uint8Array([104, 105]));
});

test('openSession forwards exit events', async () => {
  const { onExit, events } = await open();
  events.onmessage({ type: 'exit', code: 3 });
  expect(onExit).toHaveBeenCalledWith(3);
});

test('openSession passes profile, size and channels to the backend', async () => {
  await open();
  expect(invoke).toHaveBeenCalledWith(
    'session_open',
    expect.objectContaining({ profileId: 'cmd', cwd: null, cols: 80, rows: 24 }),
  );
});

test('pickDefaultProfile falls back to the first profile', () => {
  const p = (id: string) => ({ id }) as ResolvedProfile;
  expect(pickDefaultProfile([p('a'), p('b')], 'b')?.id).toBe('b');
  expect(pickDefaultProfile([p('a'), p('b')], 'nope')?.id).toBe('a');
  expect(pickDefaultProfile([p('a')], null)?.id).toBe('a');
  expect(pickDefaultProfile([], 'a')).toBeNull();
});
