import { act, renderHook } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { MAIN_SPACE } from '@/connections/spaces';
import type { ThemesSnapshot } from '@/ipc/themes';
import { defaultSettings } from '@/test/fixtures';
import { getTheme, resolveTheme, type ThemeDefinition } from '@/themes';
import { spaceThemeChoice, useActiveTheme } from '@/themes/useActiveTheme';
import { useConnections } from './connections';
import { useSettings } from './settings';
import { useThemes } from './themes';
import { useWorkspace } from './workspace';

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

describe('themes per space', () => {
  const pro = { ...MAIN_SPACE, id: 'pro', name: 'Pro', themeDark: 'nord', themeLight: 'one-light' };
  const choice = {
    colorScheme: 'system',
    themeDark: 'tilde-dark',
    themeLight: 'tilde-light',
  } as const;
  const perSpace = (themePerSpace: boolean) => {
    const { appearance } = defaultSettings;
    useSettings.setState({
      settings: { ...defaultSettings, appearance: { ...appearance, themePerSpace } },
    });
  };

  beforeEach(() => {
    perSpace(true);
    useConnections.setState((s) => ({ file: { ...s.file, spaces: [MAIN_SPACE, pro] } }));
    useWorkspace.setState({ activeSpaceId: MAIN_SPACE.id });
  });
  afterEach(() => {
    useSettings.setState({ settings: null });
    useConnections.setState((s) => ({ file: { ...s.file, spaces: [] } }));
    useWorkspace.setState({ activeSpaceId: MAIN_SPACE.id });
  });

  test('a space takes over the global choice for the slots it sets', () => {
    expect(spaceThemeChoice(choice, pro, [])).toEqual({
      ...choice,
      themeDark: 'nord',
      themeLight: 'one-light',
    });
    expect(spaceThemeChoice(choice, { themeDark: 'nord', themeLight: null }, [])).toEqual({
      ...choice,
      themeDark: 'nord',
    });
    expect(spaceThemeChoice(choice, MAIN_SPACE, [])).toEqual(choice);
    expect(spaceThemeChoice(choice, undefined, [])).toEqual(choice);
  });

  test('a theme that no longer exists leaves the global one', () => {
    expect(spaceThemeChoice(choice, { themeDark: 'gone', themeLight: null }, [])).toEqual(choice);
  });

  test('a space can use a user theme', () => {
    const user = [{ ...tilde, id: 'mine', name: 'Mine' }];
    expect(spaceThemeChoice(choice, { themeDark: 'mine', themeLight: null }, user).themeDark).toBe(
      'mine',
    );
  });

  test('the window follows the active space, and the preview still wins', () => {
    const { result } = renderHook(() => useActiveTheme());
    expect(result.current.id).toBe('tilde-dark');
    act(() => {
      useWorkspace.setState({ activeSpaceId: 'pro' });
    });
    expect(result.current.id).toBe('nord');
    act(() => {
      useThemes.getState().setPreview({ ...tilde, id: 'draft', name: 'Draft' });
    });
    expect(result.current.id).toBe('draft');
    act(() => {
      useThemes.getState().setPreview(null);
      useWorkspace.setState({ activeSpaceId: MAIN_SPACE.id });
    });
    expect(result.current.id).toBe('tilde-dark');
  });

  test('turned off, every space shows the global theme', () => {
    perSpace(false);
    useWorkspace.setState({ activeSpaceId: 'pro' });
    const { result } = renderHook(() => useActiveTheme());
    expect(result.current.id).toBe('tilde-dark');
    act(() => {
      perSpace(true);
    });
    expect(result.current.id).toBe('nord');
  });

  test('the light mode uses the light theme of the space', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: !query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    useWorkspace.setState({ activeSpaceId: 'pro' });
    const { result } = renderHook(() => useActiveTheme());
    expect(result.current.id).toBe('one-light');
  });
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
