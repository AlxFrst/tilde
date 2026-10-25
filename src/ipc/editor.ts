import { invoke } from './invoke';

/** The version of a file that was read (mirrors `StampDto` in commands/editor.rs). */
export interface Stamp {
  size: number;
  mtime: number | null;
}

/** Mirrors `EditorErrorDto`. */
export interface EditorErrorDto {
  kind: 'tooLarge' | 'binary' | 'conflict' | 'notFound' | 'io';
  message: string;
  /** For `conflict`: the version now on disk. */
  current?: Stamp;
}

const KINDS = new Set(['tooLarge', 'binary', 'conflict', 'notFound', 'io']);

export function isEditorError(e: unknown): e is EditorErrorDto {
  return (
    typeof e === 'object' &&
    e !== null &&
    KINDS.has((e as { kind?: unknown }).kind as string) &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

export interface OpenedText {
  text: string;
  stamp: Stamp;
}

export interface LocalOpened extends OpenedText {
  docId: number;
  name: string;
}

export const editorOpenRemote = (sessionId: number, path: string) =>
  invoke<OpenedText>('editor_open_remote', { sessionId, path });
/** Refused with `conflict` if the file changed since `expected`; `force` overwrites. */
export const editorSaveRemote = (
  sessionId: number,
  path: string,
  text: string,
  expected: Stamp | null,
  force: boolean,
) => invoke<Stamp>('editor_save_remote', { sessionId, path, text, expected, force });
/** Native dialog; `null` when cancelled. */
export const editorOpenLocal = () => invoke<LocalOpened | null>('editor_open_local');
export const editorSaveLocal = (
  docId: number,
  text: string,
  expected: Stamp | null,
  force: boolean,
) => invoke<Stamp>('editor_save_local', { docId, text, expected, force });
/** Reads a local document again (« Recharger »). */
export const editorReadLocal = (docId: number) =>
  invoke<OpenedText>('editor_read_local', { docId });
export const editorCloseLocal = (docId: number) =>
  invoke<undefined>('editor_close_local', { docId });
/** Raw bytes (images), 20 MiB at most. */
export const previewReadRemote = (sessionId: number, path: string) =>
  invoke<ArrayBuffer>('preview_read_remote', { sessionId, path });
export const previewReadLocal = (docId: number) =>
  invoke<ArrayBuffer>('preview_read_local', { docId });
