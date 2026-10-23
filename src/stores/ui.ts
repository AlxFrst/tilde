import { create } from 'zustand';

/** App-wide dialogs that commands can open. */
interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen });
  },
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen });
  },
}));
