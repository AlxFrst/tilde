import { act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { KeybindingsSnapshot } from '@/ipc/keybindings';
import { DEFAULT_KEYBINDINGS, matchShortcut } from '@/terminal/keys';
import { bindingOf, useKeybindings } from './keybindings';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, h: (e: { payload: unknown }) => void) => {
    handlers.set(name, h);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));
let snapshot: KeybindingsSnapshot = { bindings: {}, readOnly: false, error: null, warnings: [] };
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(snapshot)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

const key = (code: string, key: string, mods: Partial<KeyboardEvent>) => ({
  code,
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { bindings: {}, readOnly: false, error: null, warnings: [] };
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(snapshot));
});

test('defaults apply before init', () => {
  expect(bindingOf('tab.new')).toBe(DEFAULT_KEYBINDINGS['tab.new']);
  expect(bindingOf('app.unknown')).toBeNull();
});

test('overrides replace defaults', async () => {
  snapshot = { ...snapshot, bindings: { 'tab.new': 'alt+ctrl+n', 'app.settings': 'Ctrl+,' } };
  const off = await useKeybindings.getState().init();
  expect(bindingOf('tab.new')).toBe('Ctrl+Alt+N');
  expect(bindingOf('app.settings')).toBe('Ctrl+,');
  const { table } = useKeybindings.getState();
  expect(matchShortcut(key('KeyN', 'n', { ctrlKey: true, altKey: true }), table, false)).toBe(
    'tab.new',
  );
  expect(
    matchShortcut(key('KeyT', 'T', { ctrlKey: true, shiftKey: true }), table, false),
  ).toBeNull();
  off();
});

test('invalid entries keep defaults and are reported', async () => {
  snapshot = {
    ...snapshot,
    bindings: { 'tab.new': 'Ctrl+Truc' },
    warnings: ['« ../x » : identifiant de commande invalide'],
  };
  const off = await useKeybindings.getState().init();
  expect(bindingOf('tab.new')).toBe('Ctrl+Shift+T');
  expect(useKeybindings.getState().invalid).toEqual(['tab.new']);
  expect(toast.error).toHaveBeenCalledTimes(2);
  off();
});

test('null unbinds', async () => {
  snapshot = { ...snapshot, bindings: { 'tab.close': null } };
  const off = await useKeybindings.getState().init();
  expect(bindingOf('tab.close')).toBeNull();
  off();
});

test('updates on keybindings://changed', async () => {
  const off = await useKeybindings.getState().init();
  act(() => {
    handlers.get('keybindings://changed')?.({
      payload: { bindings: { 'tab.new': 'Ctrl+Alt+T' }, readOnly: true, error: null, warnings: [] },
    });
  });
  expect(bindingOf('tab.new')).toBe('Ctrl+Alt+T');
  expect(useKeybindings.getState().readOnly).toBe(true);
  off();
});

test('set and reset call the backend', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  expect(await useKeybindings.getState().set('tab.new', 'Ctrl+Alt+T')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('keybindings_set', {
    command: 'tab.new',
    binding: 'Ctrl+Alt+T',
  });
  expect(await useKeybindings.getState().reset()).toBe(true);
  expect(invoke).toHaveBeenCalledWith('keybindings_reset', { command: null });
  vi.mocked(invoke).mockRejectedValueOnce({ kind: 'readOnly', message: 'lecture seule' });
  expect(await useKeybindings.getState().set('tab.new', null)).toBe(false);
  expect(toast.error).toHaveBeenCalledWith('lecture seule');
});

test('a hand-written key that would break typing is refused, duplicates are reported', async () => {
  snapshot = {
    ...snapshot,
    bindings: {
      'tab.new': 'A',
      'terminal.copy': 'Enter',
      'tab.close': 'Ctrl+Shift+P',
      'app.x': 'F5',
    },
  };
  const off = await useKeybindings.getState().init();
  // A lone key keeps the default; function keys are fine alone.
  expect(bindingOf('tab.new')).toBe('Ctrl+Shift+T');
  expect(bindingOf('terminal.copy')).toBe('Ctrl+Shift+C');
  expect(bindingOf('app.x')).toBe('F5');
  expect(useKeybindings.getState().invalid.sort()).toEqual(['tab.new', 'terminal.copy']);
  // tab.close now shares Ctrl+Shift+P with the palette: the user is told.
  expect(
    vi
      .mocked(toast.error)
      .mock.calls.some(([m]) => typeof m === 'string' && m.includes('Ctrl+Shift+P')),
  ).toBe(true);
  off();
});
