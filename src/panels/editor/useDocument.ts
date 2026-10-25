// Loading and saving the file shown in an editor pane. The version read (size + mtime)
// goes with every save, so a file changed elsewhere is never overwritten silently.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  editorOpenRemote,
  editorReadLocal,
  editorSaveLocal,
  editorSaveRemote,
  isEditorError,
  type EditorErrorDto,
  type LocalOpened,
  type OpenedText,
  type Stamp,
} from '@/ipc/editor';
import { t } from '@/i18n';
import type { FileSource } from '@/workspace/types';

/** Local documents just opened through the dialog: their text is already here. */
const primed = new Map<number, OpenedText>();

export function primeLocal(opened: LocalOpened): void {
  primed.set(opened.docId, { text: opened.text, stamp: opened.stamp });
}

export type SaveOutcome = 'saved' | 'conflict' | 'error';

export interface DocumentState {
  status: 'loading' | 'ready' | 'error';
  /** The text as last read from or written to the file. */
  text: string;
  error: EditorErrorDto | null;
  /** The last save was refused because the file changed elsewhere. */
  conflict: boolean;
  /** `force` overwrites a file that changed elsewhere. */
  save: (text: string, force?: boolean) => Promise<SaveOutcome>;
  /** Reads the file again (dropping unsaved changes). */
  reload: () => Promise<void>;
}

const asError = (err: unknown): EditorErrorDto =>
  isEditorError(err)
    ? err
    : { kind: 'io', message: err instanceof Error ? err.message : String(err) };

/** `sessionId`: the linked SSH session for a remote file (`null` while it connects). */
export function useDocument(source: FileSource, sessionId: number | null): DocumentState {
  const [status, setStatus] = useState<DocumentState['status']>('loading');
  const [text, setText] = useState('');
  const [error, setError] = useState<EditorErrorDto | null>(null);
  const [conflict, setConflict] = useState(false);
  const stamp = useRef<Stamp | null>(null);

  const remotePath = source.kind === 'remote' ? source.path : null;
  const docId = source.kind === 'local' ? source.docId : null;

  const read = useCallback(async (): Promise<OpenedText> => {
    if (remotePath !== null) return editorOpenRemote(sessionId ?? -1, remotePath);
    const id = docId ?? -1;
    const ready = primed.get(id);
    if (ready) {
      primed.delete(id);
      return ready;
    }
    return editorReadLocal(id);
  }, [remotePath, docId, sessionId]);

  const load = useCallback(async () => {
    try {
      const opened = await read();
      stamp.current = opened.stamp;
      setText(opened.text);
      setError(null);
      setConflict(false);
      setStatus('ready');
    } catch (err) {
      setError(asError(err));
      setStatus('error');
    }
  }, [read]);

  const waiting = remotePath !== null && sessionId === null;
  const loaded = useRef(false);
  useEffect(() => {
    // Read once; a reconnection must not reload over unsaved changes.
    if (waiting || loaded.current) return;
    loaded.current = true;
    void load();
  }, [waiting, load]);

  const save = useCallback(
    async (next: string, force = false): Promise<SaveOutcome> => {
      if (remotePath !== null && sessionId === null) {
        toast.error(
          t('Connexion SSH perdue : reconnectez l’onglet SSH pour enregistrer ce fichier.'),
        );
        return 'error';
      }
      try {
        const written =
          remotePath !== null
            ? await editorSaveRemote(sessionId ?? -1, remotePath, next, stamp.current, force)
            : await editorSaveLocal(docId ?? -1, next, stamp.current, force);
        stamp.current = written;
        setText(next);
        setConflict(false);
        return 'saved';
      } catch (err) {
        const e = asError(err);
        if (e.kind === 'conflict') {
          setConflict(true);
          return 'conflict';
        }
        toast.error(t('Enregistrement impossible : {error}', { error: e.message }));
        return 'error';
      }
    },
    [remotePath, docId, sessionId],
  );

  return { status, text, error, conflict, save, reload: load };
}
