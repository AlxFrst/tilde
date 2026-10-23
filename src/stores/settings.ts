import { toast } from 'sonner';
import { create } from 'zustand';
import { formatConfigError, isConfigError, type ConfigErrorDto } from '@/ipc/errors';
import type { Settings } from '@/ipc/generated/settings';
import {
  getSettings,
  onSettingsChanged,
  onSettingsError,
  updateSettings,
  type DeepPartial,
} from '@/ipc/settings';

interface SettingsState {
  /** `null` until `init()` has loaded the snapshot. */
  settings: Settings | null;
  /** True while settings.json on disk is broken; edits are refused until it is fixed. */
  readOnly: boolean;
  error: ConfigErrorDto | null;
  /** Loads settings and subscribes to backend events; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
  /** Applies a patch. Not optimistic: state changes only once the backend accepts it. */
  update: (patch: DeepPartial<Settings>) => Promise<void>;
}

function describe(err: unknown): string {
  if (isConfigError(err)) return formatConfigError(err);
  return typeof err === 'string' ? err : 'Erreur inattendue lors de la mise à jour des réglages';
}

export const useSettings = create<SettingsState>()((set) => ({
  settings: null,
  readOnly: false,
  error: null,

  init: async () => {
    const unlisteners = await Promise.all([
      onSettingsChanged((settings) => {
        set({ settings, readOnly: false, error: null });
      }),
      onSettingsError((error) => {
        set({ readOnly: true, error });
        toast.error(formatConfigError(error));
      }),
    ]);
    const snapshot = await getSettings();
    set({ settings: snapshot.settings, readOnly: snapshot.readOnly, error: snapshot.error });
    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten();
      });
    };
  },

  update: async (patch) => {
    try {
      const settings = await updateSettings(patch);
      set({ settings });
    } catch (err) {
      toast.error(describe(err));
    }
  },
}));
