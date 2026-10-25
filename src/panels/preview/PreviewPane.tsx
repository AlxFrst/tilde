// Markdown, image and JSON preview (loaded on demand: markdown-it is not in the startup
// bundle). A preview follows an editor's text live, or shows a file as it is on disk.

import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import {
  editorOpenRemote,
  editorReadLocal,
  isEditorError,
  previewReadLocal,
  previewReadRemote,
} from '@/ipc/editor';
import { openUrl } from '@/ipc/session';
import type { PanelProps } from '@/panels/registry';
import { useEditors } from '@/stores/editors';
import { useSessionId } from '@/terminal/sessionRegistry';
import type { PreviewPanel, PreviewSource } from '@/workspace/types';
import { JsonTree } from './JsonTree';
import { renderMarkdown } from './markdown';
import { imageMime, previewKind } from './previewKind';

/** An editor's text is re-rendered once typing pauses. */
const LIVE_DELAY_MS = 300;

export function previewName(source: PreviewSource): string {
  if (source.kind === 'remote') return source.path.split('/').pop() ?? source.path;
  return source.name;
}

function errorText(err: unknown): string {
  if (isEditorError(err)) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** The text of the source, live for an editor, read once (and on « Actualiser ») otherwise. */
function useSourceText(source: PreviewSource, sessionId: number | null, enabled: boolean) {
  const editorText = useEditors((s) =>
    source.kind === 'editor' ? (s.docs[source.editorLeafId]?.text ?? null) : null,
  );
  const [live, setLive] = useState(editorText);
  useEffect(() => {
    const timer = setTimeout(() => {
      setLive(editorText);
    }, LIVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [editorText]);

  const [fileText, setFileText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const remotePath = source.kind === 'remote' ? source.path : null;
  const docId = source.kind === 'local' ? source.docId : null;
  const fromFile = enabled && source.kind !== 'editor';
  const waiting = remotePath !== null && sessionId === null;
  useEffect(() => {
    if (!fromFile || waiting) return;
    let cancelled = false;
    const read =
      remotePath !== null
        ? editorOpenRemote(sessionId ?? -1, remotePath)
        : editorReadLocal(docId ?? -1);
    read.then(
      (opened) => {
        if (cancelled) return;
        setFileText(opened.text);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fromFile, waiting, remotePath, docId, sessionId, version]);

  const text = source.kind === 'editor' ? (live ?? editorText) : fileText;
  return {
    text,
    error,
    reload: () => {
      setVersion((v) => v + 1);
    },
  };
}

function useImage(source: PreviewSource, sessionId: number | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const remotePath = source.kind === 'remote' ? source.path : null;
  const docId = source.kind === 'local' ? source.docId : null;
  const name = previewName(source);
  useEffect(() => {
    if (!enabled || source.kind === 'editor') return;
    if (remotePath !== null && sessionId === null) return;
    let created: string | null = null;
    let cancelled = false;
    const read =
      remotePath !== null
        ? previewReadRemote(sessionId ?? -1, remotePath)
        : previewReadLocal(docId ?? -1);
    read.then(
      (bytes) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([bytes], { type: imageMime(name) }));
        setUrl(created);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [enabled, source.kind, remotePath, docId, sessionId, name, version]);
  return {
    url,
    error,
    reload: () => {
      setVersion((v) => v + 1);
    },
  };
}

/** Links open in the browser (web links only); nothing else navigates. */
function onPreviewClick(e: MouseEvent<HTMLDivElement>) {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
  } else if (/^https?:/i.test(href)) {
    void openUrl(href);
  }
}

function MarkdownView({ text }: { text: string }) {
  const imageTitle = t('Image non chargée');
  const html = useMemo(() => renderMarkdown(text, imageTitle), [text, imageTitle]);
  return (
    <div
      className="tilde-prose mx-auto max-w-3xl px-6 py-4 select-text"
      onClick={onPreviewClick}
      // markdown-it with html:false and a link allow-list: see markdown.ts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function JsonView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(text) as unknown, error: null };
    } catch (err) {
      return { value: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [text]);
  if (parsed.error !== null) {
    return (
      <p role="alert" className="p-4 text-sm text-warning">
        {t('JSON invalide : {error}', { error: parsed.error })}
      </p>
    );
  }
  return (
    <div className="p-3 select-text">
      <JsonTree value={parsed.value} />
    </div>
  );
}

export default function PreviewPane({ state }: PanelProps<PreviewPanel>) {
  const { source } = state;
  const name = previewName(source);
  const kind = previewKind(name);
  const sessionId = useSessionId(source.kind === 'remote' ? source.linkedLeafId : '');
  const sid = source.kind === 'remote' ? sessionId : null;
  const text = useSourceText(source, sid, kind === 'markdown' || kind === 'json');
  const image = useImage(source, sid, kind === 'image');
  const error = kind === 'image' ? image.error : text.error;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="truncate font-medium">{t('Aperçu — {name}', { name })}</span>
        {source.kind === 'editor' && <span className="text-text-muted">{t('en direct')}</span>}
        {source.kind !== 'editor' && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => {
              if (kind === 'image') image.reload();
              else text.reload();
            }}
          >
            <RotateCcw strokeWidth={1.5} />
            {t('Actualiser')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === null && (
          <p className="p-4 text-sm text-text-muted">
            {t('Pas d’aperçu pour ce type de fichier.')}
          </p>
        )}
        {error !== null && <p className="p-4 text-sm text-warning">{error}</p>}
        {error === null && kind === 'markdown' && text.text !== null && (
          <MarkdownView text={text.text} />
        )}
        {error === null && kind === 'json' && text.text !== null && <JsonView text={text.text} />}
        {error === null && kind === 'image' && image.url && (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={image.url}
              alt={name}
              className="max-h-full max-w-full object-contain [background:repeating-conic-gradient(var(--tilde-surface-2)_0%_25%,transparent_0%_50%)_50%/16px_16px]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
