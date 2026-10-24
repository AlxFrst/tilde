import { create } from 'zustand';
import type { Space } from '@/ipc/connections';

export type SettingsSectionId =
  'appearance' | 'themes' | 'terminal' | 'shortcuts' | 'ssh' | 'sftp' | 'general';

/** App-wide dialogs that commands can open. */
interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** The page shown in the settings (kept between openings). */
  settingsSection: SettingsSectionId;
  setSettingsSection: (s: SettingsSectionId) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** A shortcut is being recorded: app shortcuts are paused. */
  recordingShortcut: boolean;
  /** Every connection, of every space, and the ~/.ssh/config hosts. */
  libraryOpen: boolean;
  setLibraryOpen: (open: boolean) => void;
  /** The space being created (`'new'`) or edited. */
  spaceDialog: Space | 'new' | null;
  setSpaceDialog: (s: Space | 'new' | null) => void;
}

export const useUi = create<UiState>()((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
  settingsSection: 'appearance',
  setSettingsSection: (settingsSection) => {
    set({ settingsSection });
  },
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen });
  },
  recordingShortcut: false,
  libraryOpen: false,
  setLibraryOpen: (libraryOpen) => {
    set({ libraryOpen });
  },
  spaceDialog: null,
  setSpaceDialog: (spaceDialog) => {
    set({ spaceDialog });
  },
}));
