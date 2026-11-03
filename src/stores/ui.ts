import { create } from 'zustand';
import type { Space } from '@/ipc/connections';
import type { Rect } from '@/workspace/tree';

/** Where a session dragged from the Rail would land on the content, and what it says. */
export interface ViewDropPreview {
  /** In fractions of the content area. */
  rect: Rect;
  label: string;
  /** The drop would do nothing (the view is full). */
  bad: boolean;
}

const RAIL_HIDDEN_KEY = 'tilde.rail.hidden';

/** Whether the Rail was hidden last time (per machine; false if storage is unavailable). */
export function loadRailHidden(): boolean {
  try {
    return localStorage.getItem(RAIL_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveRailHidden(hidden: boolean): void {
  try {
    localStorage.setItem(RAIL_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // Storage unavailable: the Rail simply shows again next time.
  }
}

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
  /** The server monitor shown over the session (Peek), for this SSH pane. */
  peek: { sshLeafId: string } | null;
  setPeek: (peek: { sshLeafId: string } | null) => void;
  /** The Rail is hidden; it slides over the content when the mouse reaches the edge. */
  railHidden: boolean;
  setRailHidden: (hidden: boolean) => void;
  /** The space being created (`'new'`) or edited. */
  spaceDialog: Space | 'new' | null;
  setSpaceDialog: (s: Space | 'new' | null) => void;
  /** A session is dragged over the content: where it would land. */
  viewDrop: ViewDropPreview | null;
  setViewDrop: (p: ViewDropPreview | null) => void;
  /** A row of the Rail is being dragged (a hidden Rail stays out until it is dropped). */
  railDragging: boolean;
  setRailDragging: (dragging: boolean) => void;
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
  peek: null,
  setPeek: (peek) => {
    set({ peek });
  },
  railHidden: loadRailHidden(),
  setRailHidden: (railHidden) => {
    saveRailHidden(railHidden);
    set({ railHidden });
  },
  libraryOpen: false,
  setLibraryOpen: (libraryOpen) => {
    set({ libraryOpen });
  },
  spaceDialog: null,
  setSpaceDialog: (spaceDialog) => {
    set({ spaceDialog });
  },
  viewDrop: null,
  setViewDrop: (viewDrop) => {
    set({ viewDrop });
  },
  railDragging: false,
  setRailDragging: (railDragging) => {
    set({ railDragging });
  },
}));
