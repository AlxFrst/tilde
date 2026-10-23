import { toast } from 'sonner';
import { create } from 'zustand';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import {
  onThemesChanged,
  themesDelete,
  themesList,
  themesSave,
  type ThemeFileError,
  type ThemesSnapshot,
} from '@/ipc/themes';
import { parseThemeFile, serializeTheme, ThemeError } from '@/themes/parse';
import { getTheme } from '@/themes/registry';
import type { ThemeDefinition } from '@/themes/types';

interface ThemesState {
  /** Valid user themes, sorted by name. */
  user: ThemeDefinition[];
  /** Files of `themes/` that cannot be used. */
  errors: ThemeFileError[];
  /** The theme being edited, shown on the whole window while the editor is open. */
  preview: ThemeDefinition | null;
  /** Loads the user themes and follows changes; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
  /** Writes `themes/<id>.json`; `false` (with a toast) when it fails. */
  save: (t: ThemeDefinition) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  setPreview: (t: ThemeDefinition | null) => void;
}

const errorKey = (e: ThemeFileError) => `${e.file}\n${e.message}`;

function describe(err: unknown): string {
  if (isConfigError(err)) return formatConfigError(err, 'thème');
  return typeof err === 'string' ? err : 'Erreur inattendue';
}

function load(snapshot: ThemesSnapshot): Pick<ThemesState, 'user' | 'errors'> {
  const user: ThemeDefinition[] = [];
  const errors = [...snapshot.errors];
  for (const { id, data } of snapshot.themes) {
    const file = `${id}.json`;
    if (getTheme(id)) {
      errors.push({ file, message: 'id réservé par un thème intégré : renommez le fichier' });
      continue;
    }
    try {
      user.push(parseThemeFile(data, id));
    } catch (e) {
      if (!(e instanceof ThemeError)) throw e;
      errors.push({ file, message: e.message });
    }
  }
  user.sort((a, b) => a.name.localeCompare(b.name));
  return { user, errors };
}

export const useThemes = create<ThemesState>()((set, get) => {
  const apply = (snapshot: ThemesSnapshot) => {
    const known = new Set(get().errors.map(errorKey));
    const next = load(snapshot);
    for (const e of next.errors) {
      if (!known.has(errorKey(e))) toast.error(`themes/${e.file} : ${e.message}`);
    }
    set(next);
  };

  return {
    user: [],
    errors: [],
    preview: null,

    init: async () => {
      const unlisten = await onThemesChanged(apply);
      apply(await themesList());
      return unlisten;
    },

    save: async (t) => {
      try {
        await themesSave(t.id, JSON.parse(serializeTheme(t)));
        return true;
      } catch (err) {
        toast.error(describe(err));
        return false;
      }
    },

    remove: async (id) => {
      try {
        await themesDelete(id);
        return true;
      } catch (err) {
        toast.error(describe(err));
        return false;
      }
    },

    setPreview: (preview) => {
      set({ preview });
    },
  };
});
