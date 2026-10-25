import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ConfigErrorDto } from './errors';
import type { Connection, ConnectionsFile, Folder, Space } from './generated/connections';

export type { Connection, ConnectionsFile, Folder, Recent, Space } from './generated/connections';

/** Mirrors `ConnectionsView` in src-tauri/src/commands/connections.rs. */
export interface ConnectionsView {
  file: ConnectionsFile;
  readOnly: boolean;
  error: ConfigErrorDto | null;
  /** Hand-written values that will be refused when opening (one line each). */
  warnings: string[];
}

export interface ImportReport {
  imported: number;
  skipped: number;
  /** Imported connections that use a key or a jump host: worth a look. */
  review: string[];
}

/** Icons a connection may use (mirrors `ICONS` in crates/tilde-config/src/connections.rs). */
export const CONNECTION_ICONS = [
  'server',
  'database',
  'cloud',
  'globe',
  'terminal',
  'box',
  'cpu',
  'shield',
  'house',
  'rocket',
] as const;

/** Icons a space may use (mirrors `SPACE_ICONS` in crates/tilde-config/src/connections.rs). */
export const SPACE_ICONS = [...CONNECTION_ICONS, 'briefcase', 'user'] as const;

export const getConnections = () => invoke<ConnectionsView>('connections_get');
/** An empty `id` creates the connection. Rejects with a ConfigErrorDto (`path` = field). */
export const upsertConnection = (connection: Connection) =>
  invoke<Connection>('connections_upsert', { connection });
export const removeConnection = (id: string) => invoke<undefined>('connections_remove', { id });
export const setFavorite = (id: string, favorite: boolean) =>
  invoke<undefined>('connections_set_favorite', { id, favorite });
/** Into `folderId` (`null`: the root), just before `before` (`null`: last). */
export const moveConnection = (id: string, folderId: string | null, before: string | null) =>
  invoke<undefined>('connections_move', { id, folderId, before });
export const upsertFolder = (folder: Folder) => invoke<Folder>('folders_upsert', { folder });
export const removeFolder = (id: string) => invoke<undefined>('folders_remove', { id });
/** An empty `id` creates the space (and writes the implicit « Principal » first). */
export const upsertSpace = (space: Space) => invoke<Space>('spaces_upsert', { space });
/** Its folders and connections move to the first remaining space. */
export const removeSpace = (id: string) => invoke<undefined>('spaces_remove', { id });
/** Native file dialogs; `null` / `false` when the user cancels. */
export const importConnections = () => invoke<ImportReport | null>('connections_import');
export const exportConnections = () => invoke<boolean>('connections_export');
export const openConnectionsFile = () => invoke<undefined>('open_connections_file');

export const onConnectionsChanged = (cb: (v: ConnectionsView) => void): Promise<UnlistenFn> =>
  listen<ConnectionsView>('connections://changed', (e) => {
    cb(e.payload);
  });
