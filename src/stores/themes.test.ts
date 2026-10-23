import { act, renderHook } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ThemesSnapshot } from '@/ipc/themes';
import { getTheme, resolveTheme, type ThemeDefinition } from '@/themes';
import { useActiveTheme } from '@/themes/useActiveTheme';
import { useThemes } from './themes';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, h: (e: { payload: unknown }) => void) => {
    handlers.set(name, h);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));
let snapshot: ThemesSnapshot = { themes: [], errors: [] };
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(snapshot)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const tilde = getTheme('tilde-dark') as ThemeDefinition;
const mine = { id: 'mine', data: { name: 'Mine', terminal: tilde.terminal } };

beforeEach(() => {
  vi.clearAllMocks();
  useThemes.setState({ user: [], errors: [], preview: null });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

test('loads valid user themes and reports broken ones', async () => {
  snapshot = {
    themes: [mine, { id: 'bad', data: { name: 'Bad' } }],
    errors: [{ file: 'zz.json', message: 'JSON invalide' }],
  };
  const off = await useThemes.getState().init();
  const { user, errors } = useThemes.getState();
  expect(user.map((t) => t.id)).toEqual(['mine']);
  expect(user[0]?.ui.bg).toBe('#0B0E14');
  expect(errors.map((e) => e.file).sort()).toEqual(['bad.json', 'zz.json']);
  expect(toast.error).toHaveBeenCalledTimes(2);
  off();
});

test('missing user theme falls back to builtin', () => {
  const user = [{ ...tilde, id: 'mine', name: 'Mine' }];
  const choice = { colorScheme: 'dark', themeDark: 'gone', themeLight: 'tilde-light' } as const;
  expect(resolveTheme(choice, true, user).id).toBe('tilde-dark');
  expect(resolveTheme({ ...choice, themeDark: 'mine' }, true, user).id).toBe('mine');
});

test('user theme cannot shadow a builtin id', async () => {
  snapshot = {
    themes: [{ id: 'nord', data: { name: 'Fake', terminal: tilde.terminal } }],
    errors: [],
  };
  const off = await useThemes.getState().init();
  expect(useThemes.getState().user).toEqual([]);
  expect(useThemes.getState().errors[0]?.message).toMatch(/réservé/);
  off();
});

test('preview overrides the resolved theme', () => {
  const { result } = renderHook(() => useActiveTheme());
  expect(result.current.id).toBe('tilde-dark');
  act(() => {
    useThemes.getState().setPreview({ ...tilde, id: 'draft', name: 'Draft' });
  });
  expect(result.current.id).toBe('draft');
  act(() => {
    useThemes.getState().setPreview(null);
  });
  expect(result.current.id).toBe('tilde-dark');
});

test('reloads on themes://changed', async () => {
  snapshot = { themes: [], errors: [] };
  const off = await useThemes.getState().init();
  expect(useThemes.getState().user).toEqual([]);
  act(() => {
    handlers.get('themes://changed')?.({ payload: { themes: [mine], errors: [] } });
  });
  expect(useThemes.getState().user.map((t) => t.id)).toEqual(['mine']);
  off();
});

test('save sends the serialized theme and reports failures', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(undefined);
  expect(await useThemes.getState().save({ ...tilde, id: 'mine', name: 'Mine' })).toBe(true);
  const [cmd, args] = vi.mocked(invoke).mock.calls[0] ?? [];
  expect(cmd).toBe('themes_save');
  expect(args).toMatchObject({ id: 'mine', data: { version: 1, name: 'Mine' } });
  vi.mocked(invoke).mockRejectedValueOnce({ kind: 'io', message: 'disque plein' });
  expect(await useThemes.getState().save({ ...tilde, id: 'mine', name: 'Mine' })).toBe(false);
  expect(toast.error).toHaveBeenCalled();
});
