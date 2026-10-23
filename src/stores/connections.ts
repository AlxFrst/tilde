import { create } from 'zustand';
import {
  getConnections,
  onConnectionsChanged,
  removeConnection,
  removeFolder,
  setFavorite,
  upsertConnection,
  upsertFolder,
  type Connection,
  type ConnectionsFile,
  type Folder,
} from '@/ipc/connections';
import type { ConfigErrorDto } from '@/ipc/errors';
import { sshHosts, type SshHostEntry } from '@/ipc/ssh';

interface ConnectionsState {
  loaded: boolean;
  file: ConnectionsFile;
  /** connections.json is broken on disk: shown, but not editable until fixed. */
  readOnly: boolean;
  error: ConfigErrorDto | null;
  /** Saved connections that cannot be opened as written. */
  warnings: string[];
  /** Concrete hosts of ~/.ssh/config. */
  sshHosts: SshHostEntry[];
  /** Loads everything and follows backend changes; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
  refreshSshHosts: () => Promise<void>;
  /** Not optimistic: the list changes when the backend confirms (connections://changed). */
  save: (c: Connection) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  saveFolder: (f: Folder) => Promise<Folder>;
  removeFolder: (id: string) => Promise<void>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
  /** The connection in the form: an existing one, or `'new'` (with optional presets). */
  editing: Connection | 'new' | null;
  setEditing: (c: Connection | 'new' | null) => void;
  editingFolder: Folder | 'new' | null;
  setEditingFolder: (f: Folder | 'new' | null) => void;
  /** Turns an ~/.ssh/config host into a saved connection, then opens its form. */
  adopt: (alias: string) => Promise<void>;
}

/** A connection with every optional field empty. */
export const blankConnection = (preset: Partial<Connection> = {}): Connection => ({
  id: '',
  name: '',
  host: '',
  port: null,
  user: null,
  identityFile: null,
  proxyJump: null,
  forwardAgent: null,
  folderId: null,
  color: null,
  icon: null,
  tags: [],
  favorite: false,
  ...preset,
});

const EMPTY: ConnectionsFile = { version: 1, folders: [], connections: [], recents: [] };

export const useConnections = create<ConnectionsState>()((set, get) => ({
  loaded: false,
  file: EMPTY,
  readOnly: false,
  error: null,
  warnings: [],
  sshHosts: [],

  init: async () => {
    const off = await onConnectionsChanged((v) => {
      set({ file: v.file, readOnly: v.readOnly, error: v.error, warnings: v.warnings });
    });
    const view = await getConnections();
    set({
      file: view.file,
      readOnly: view.readOnly,
      error: view.error,
      warnings: view.warnings,
      loaded: true,
    });
    void get().refreshSshHosts();
    // ~/.ssh/config may be edited while Tilde runs: re-read it when the window is back.
    const onFocus = () => void get().refreshSshHosts();
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  },

  refreshSshHosts: async () => {
    const hosts = await sshHosts().catch(() => null);
    if (hosts) set({ sshHosts: hosts });
  },

  save: (c) => upsertConnection(c),
  remove: (id) => removeConnection(id),
  saveFolder: (f) => upsertFolder(f),
  removeFolder: (id) => removeFolder(id),
  setFavorite: (id, favorite) => setFavorite(id, favorite),
  editing: null,
  setEditing: (editing) => {
    set({ editing });
  },
  editingFolder: null,
  setEditingFolder: (editingFolder) => {
    set({ editingFolder });
  },
  adopt: async (alias) => {
    const saved = await get().save(blankConnection({ name: alias, host: alias }));
    set({ editing: saved });
  },
}));
