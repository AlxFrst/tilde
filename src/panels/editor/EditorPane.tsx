// The built-in editor pane (loaded on demand: CodeMirror is not in the startup bundle).

import {
  Check,
  ExternalLink,
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { editorCloseLocal } from '@/ipc/editor';
import { cn } from '@/lib/utils';
import { sftpEdit } from '@/ipc/sftp';
import { previewKind } from '@/panels/preview/previewKind';
import type { PanelProps } from '@/panels/registry';
import { useEditors } from '@/stores/editors';
import { useSettings } from '@/stores/settings';
import { useWorkspace, zoomedLeafOf } from '@/stores/workspace';
import { useSessionId } from '@/terminal/sessionRegistry';
import { useActiveTheme } from '@/themes/useActiveTheme';
import { leaves } from '@/workspace/tree';
import type { EditorPanel } from '@/workspace/types';
import { createEditor, type EditorHandle } from './codemirror';
import { fileName } from './fileName';
import { editorTheme } from './editorTheme';
import { languageFor, languageLabel } from './languages';
import { useDocument } from './useDocument';

export default function EditorPane({ tabId, leafId, state, active }: PanelProps<EditorPanel>) {
  const { source } = state;
  const name = fileName(source);
  const sessionId = useSessionId(source.kind === 'remote' ? source.linkedLeafId : '');
  const doc = useDocument(source, source.kind === 'remote' ? sessionId : null);
  const theme = useActiveTheme();
  const font = useSettings((s) => s.settings?.terminal);
  const dirty = useEditors((s) => s.docs[leafId]?.dirty ?? false);
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorHandle | null>(null);
  const current = useRef('');
  const saved = useRef('');
  const [saving, setSaving] = useState(false);
  const alone = useWorkspace((s) => {
    const tab = s.tabs.find((x) => x.id === tabId);
    return tab ? zoomedLeafOf(tab, s.zoomed) === leafId : false;
  });
  // Beside other panes, the pane header above carries the zoom button.
  const single = useWorkspace((s) => {
    const tab = s.tabs.find((x) => x.id === tabId);
    return tab ? leaves(tab.root).length === 1 : false;
  });

  const fontSpec = {
    family: font?.fontFamily ?? 'JetBrains Mono Variable',
    size: font?.fontSize ?? 14,
  };
  const latest = useRef({ doc, fontSpec, theme });
  useLayoutEffect(() => {
    latest.current = { doc, fontSpec, theme };
  });

  const markText = (text: string) => {
    current.current = text;
    useEditors.getState().set(leafId, { name, text, dirty: text !== saved.current });
  };

  // One save at a time: a second Ctrl+S during a save would send the old version and
  // get a false « changed on the server ». It runs once the first one is done.
  const inFlight = useRef(false);
  const again = useRef(false);
  const save = async (force = false): Promise<void> => {
    // Nothing changed since the last save (or since opening): nothing to write.
    if (!force && !inFlight.current && current.current === saved.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const text = current.current;
    const outcome = await latest.current.doc.save(text, force);
    inFlight.current = false;
    setSaving(false);
    if (outcome === 'saved') {
      saved.current = text;
      useEditors.getState().set(leafId, { dirty: current.current !== text });
    }
    if (again.current) {
      again.current = false;
      if (outcome === 'saved' && current.current !== text) await save();
    }
  };
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  // The editor is created once the text has arrived.
  const ready = doc.status === 'ready';
  useEffect(() => {
    const parent = container.current;
    if (!ready || !parent || editor.current) return;
    const { doc: d, fontSpec: f, theme: th } = latest.current;
    saved.current = d.text;
    markText(d.text);
    editor.current = createEditor({
      parent,
      doc: d.text,
      language: null,
      theme: editorTheme(th, f),
      onChange: markText,
      onSave: () => void saveRef.current(),
    });
    let cancelled = false;
    void languageFor(name).then((lang) => {
      if (!cancelled) editor.current?.setLanguage(lang);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; later values via refs
  }, [ready]);

  const docId = source.kind === 'local' ? source.docId : null;
  useEffect(
    () => () => {
      editor.current?.destroy();
      editor.current = null;
      useEditors.getState().forget(leafId);
      // Once the pane is really gone (not a remount), Rust can forget the local path.
      setTimeout(() => {
        const open = useWorkspace
          .getState()
          .tabs.some((tab) => leaves(tab.root).some((l) => l.id === leafId));
        if (docId !== null && !open) void editorCloseLocal(docId).catch(() => undefined);
      }, 0);
    },
    [leafId, docId],
  );

  useEffect(() => {
    editor.current?.setTheme(editorTheme(theme, fontSpec));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontSpec is rebuilt each render
  }, [theme, fontSpec.family, fontSpec.size]);

  useEffect(() => {
    if (active) editor.current?.view.focus();
  }, [active, ready]);

  const reload = async () => {
    await doc.reload();
  };
  // After « Recharger », show the text read from disk.
  useEffect(() => {
    if (!editor.current || doc.text === saved.current) return;
    saved.current = doc.text;
    editor.current.setDoc(doc.text);
    markText(doc.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new text only
  }, [doc.text]);

  const openExternal = () => {
    if (source.kind !== 'remote' || sessionId === null) return;
    sftpEdit(sessionId, source.path).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span
          className="truncate font-medium"
          title={source.kind === 'remote' ? source.path : name}
        >
          {name}
        </span>
        {dirty && (
          <span
            aria-label={t('Modifié')}
            title={t('Modifié')}
            className="size-2 rounded-full bg-primary"
          />
        )}
        <span className="text-text-muted">{languageLabel(name)}</span>
        <span className="ml-auto flex items-center gap-1">
          {previewKind(name) !== null && previewKind(name) !== 'image' && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                useWorkspace
                  .getState()
                  .openPreview(leafId, { kind: 'editor', editorLeafId: leafId, name });
              }}
            >
              <Eye strokeWidth={1.5} />
              {t('Aperçu')}
            </Button>
          )}
          {source.kind === 'remote' && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('Ouvrir dans l’éditeur externe')}
              title={t('Ouvrir dans l’éditeur externe')}
              onClick={openExternal}
            >
              <ExternalLink strokeWidth={1.5} />
            </Button>
          )}
          {single && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={alone ? t('Réduire le panneau') : t('Agrandir le panneau')}
              title={alone ? t('Réduire le panneau') : t('Agrandir le panneau')}
              onClick={() => {
                useWorkspace.getState().toggleZoom(tabId, leafId);
              }}
            >
              {alone ? <Minimize2 strokeWidth={1.5} /> : <Maximize2 strokeWidth={1.5} />}
            </Button>
          )}
          {/* What the button says is the file's state: to save, saving, saved. */}
          <Button
            variant={dirty && !saving ? 'default' : 'ghost'}
            size="xs"
            disabled={!ready || saving || !dirty}
            onClick={() => void save()}
            title="Ctrl+S"
            className={cn(ready && !dirty && !saving && 'text-text-muted disabled:opacity-100')}
          >
            {saving ? (
              <Loader2 className="animate-spin" strokeWidth={1.5} />
            ) : ready && !dirty ? (
              <Check className="text-success" strokeWidth={2} />
            ) : (
              <Save strokeWidth={1.5} />
            )}
            {saving ? t('Enregistrement…') : ready && !dirty ? t('Enregistré') : t('Enregistrer')}
          </Button>
        </span>
      </div>

      {doc.conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
        >
          <TriangleAlert className="size-3.5" strokeWidth={1.5} />
          {t('Le fichier a changé sur le serveur depuis son ouverture.')}
          <Button size="xs" variant="outline" onClick={() => void save(true)}>
            {t('Écraser')}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void reload()}>
            <RotateCcw strokeWidth={1.5} />
            {t('Recharger')}
          </Button>
        </div>
      )}

      {doc.status === 'error' && doc.error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <p className="text-text-muted">{doc.error.message}</p>
          {source.kind === 'remote' &&
            (doc.error.kind === 'binary' || doc.error.kind === 'tooLarge') && (
              <Button variant="outline" size="sm" onClick={openExternal}>
                <ExternalLink strokeWidth={1.5} />
                {t('Ouvrir dans l’éditeur externe')}
              </Button>
            )}
        </div>
      )}
      {doc.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
          {source.kind === 'remote' && sessionId === null
            ? t('En attente de la connexion SSH…')
            : t('Ouverture…')}
        </div>
      )}
      <div
        ref={container}
        className={doc.status === 'ready' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}
      />
    </div>
  );
}
