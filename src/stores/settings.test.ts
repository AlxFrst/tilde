import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { formatConfigError, type ConfigErrorDto } from '@/ipc/errors';
import type { Settings } from '@/ipc/generated/settings';
import { useSettings } from './settings';
import { defaultSettings } from '@/test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const handlers = new Map<string, EventCallback<unknown>>();

function emit(name: string, payload: unknown) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  handler({ event: name, id: 0, payload });
}

beforeEach(() => {
  handlers.clear();
  vi.mocked(listen).mockImplementation((name, cb) => {
    handlers.set(name, cb);
    return Promise.resolve(() => undefined);
  });
  vi.mocked(invoke).mockReset();
  vi.mocked(toast.error).mockReset();
  useSettings.setState({ settings: null, readOnly: false, error: null });
});

test('init loads snapshot and subscribes', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    settings: defaultSettings,
    readOnly: false,
    error: null,
  });
  await useSettings.getState().init();
  expect(invoke).toHaveBeenCalledWith('settings_get');
  expect(useSettings.getState().settings).toEqual(defaultSettings);
  expect(handlers.has('settings://changed')).toBe(true);
  expect(handlers.has('settings://error')).toBe(true);
});

test('changed event replaces settings and clears error', async () => {
  const brokenError: ConfigErrorDto = { kind: 'parse', message: 'boom', line: 1, column: 2 };
  vi.mocked(invoke).mockResolvedValueOnce({
    settings: defaultSettings,
    readOnly: true,
    error: brokenError,
  });
  await useSettings.getState().init();
  const next: Settings = {
    ...defaultSettings,
    appearance: { ...defaultSettings.appearance, density: 'compact' },
  };
  emit('settings://changed', next);
  const state = useSettings.getState();
  expect(state.settings?.appearance.density).toBe('compact');
  expect(state.readOnly).toBe(false);
  expect(state.error).toBeNull();
});

test('error event toasts and turns read-only', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    settings: defaultSettings,
    readOnly: false,
    error: null,
  });
  await useSettings.getState().init();
  emit('settings://error', { kind: 'parse', message: 'boom', line: 3, column: 5 });
  expect(useSettings.getState().readOnly).toBe(true);
  expect(toast.error).toHaveBeenCalled();
});

test('update failure keeps previous settings and toasts', async () => {
  useSettings.setState({ settings: defaultSettings });
  vi.mocked(invoke).mockRejectedValueOnce({
    kind: 'invalid',
    message: 'valeurs hors limites : terminal.fontSize (100 n’est pas entre 6 et 72)',
    path: 'terminal.fontSize',
  });
  await useSettings.getState().update({ terminal: { fontSize: 100 } });
  expect(invoke).toHaveBeenCalledWith('settings_update', {
    patch: { terminal: { fontSize: 100 } },
  });
  expect(useSettings.getState().settings).toEqual(defaultSettings);
  expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain('terminal.fontSize');
});

test('update success stores the returned settings', async () => {
  useSettings.setState({ settings: defaultSettings });
  const returned = { ...defaultSettings, version: 1 };
  returned.terminal = { ...defaultSettings.terminal, fontSize: 20 };
  vi.mocked(invoke).mockResolvedValueOnce(returned);
  await useSettings.getState().update({ terminal: { fontSize: 20 } });
  expect(useSettings.getState().settings?.terminal.fontSize).toBe(20);
});

test('formatConfigError includes line and column for parse errors', () => {
  const text = formatConfigError({ kind: 'parse', message: 'EOF', line: 3, column: 5 });
  expect(text).toContain('ligne 3');
  expect(text).toContain('colonne 5');
});
