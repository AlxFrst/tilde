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
}

const EMPTY: ConnectionsFile = { version: 1, folders: [], connections: [], recents: [] };

export const useConnections = create<ConnectionsState>()((set, get) => ({
  loaded: false,
  file: EMPTY,
  readOnly: false,
  error: null,
  sshHosts: [],

  init: async () => {
    const off = await onConnectionsChanged((v) => {
      set({ file: v.file, readOnly: v.readOnly, error: v.error });
    });
    const view = await getConnections();
    set({ file: view.file, readOnly: view.readOnly, error: view.error, loaded: true });
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
}));
