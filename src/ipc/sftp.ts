import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Mirrors `RemoteEntry` in crates/tilde-ssh/src/sftp.rs. */
export interface RemoteEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  /** Seconds since the Unix epoch. */
  modified: number | null;
  /** Permission bits (0o7777). */
  permissions: number | null;
}

/** Mirrors `TransferState` / `TransferInfo` in crates/tilde-ssh/src/transfer.rs. */
export type TransferState =
  | { kind: 'queued' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'conflict'; message: string };

export interface TransferInfo {
  id: number;
  session: number;
  direction: 'upload' | 'download';
  local: string;
  remote: string;
  total: number;
  done: number;
  bytesPerSec: number;
  state: TransferState;
}

export const sftpHome = (sessionId: number) => invoke<string>('sftp_home', { sessionId });
export const sftpList = (sessionId: number, path: string) =>
  invoke<RemoteEntry[]>('sftp_list', { sessionId, path });
export const sftpMkdir = (sessionId: number, path: string) =>
  invoke<undefined>('sftp_mkdir', { sessionId, path });
/** An empty file; refused if `path` already exists. */
export const sftpCreateFile = (sessionId: number, path: string) =>
  invoke<undefined>('sftp_create_file', { sessionId, path });
export const sftpRename = (sessionId: number, from: string, to: string) =>
  invoke<undefined>('sftp_rename', { sessionId, from, to });
/** Resolves to the number of entries deleted. */
export const sftpRemove = (sessionId: number, path: string) =>
  invoke<number>('sftp_remove', { sessionId, path });
export const sftpChmod = (sessionId: number, path: string, mode: number) =>
  invoke<undefined>('sftp_chmod', { sessionId, path, mode });
/** To the Downloads folder, or a folder picked in a native dialog (`saveAs`). */
export const sftpDownload = (sessionId: number, paths: string[], saveAs: boolean) =>
  invoke<number[]>('sftp_download', { sessionId, paths, saveAs });
/** `localPaths: null` opens a native file picker. */
export const sftpUpload = (sessionId: number, localPaths: string[] | null, remoteDir: string) =>
  invoke<number[]>('sftp_upload', { sessionId, localPaths, remoteDir });
export const sftpEdit = (sessionId: number, path: string) =>
  invoke<number>('sftp_edit', { sessionId, path });
export const editResolve = (editId: number, overwrite: boolean) =>
  invoke<undefined>('edit_resolve', { editId, overwrite });
export const transfersList = () => invoke<TransferInfo[]>('transfers_list');
export const transferCancel = (id: number) => invoke<undefined>('transfer_cancel', { id });
export const transferRetry = (id: number) => invoke<undefined>('transfer_retry', { id });
export const transfersClear = () => invoke<undefined>('transfers_clear');
export const transferReveal = (id: number) => invoke<undefined>('transfer_reveal', { id });

export const onTransfer = (cb: (t: TransferInfo) => void): Promise<UnlistenFn> =>
  listen<TransferInfo>('sftp://transfer', (e) => {
    cb(e.payload);
  });

/** POSIX join without doubled slashes. */
export function joinRemote(dir: string, name: string): string {
  if (!dir) return name;
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** The parent directory (`/` stays `/`). */
export function parentOf(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? '/' : trimmed.slice(0, i);
}
