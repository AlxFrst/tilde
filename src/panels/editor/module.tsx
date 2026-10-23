import { FileCode } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { editorOpenLocal, isEditorError } from '@/ipc/editor';
import type { PanelModule, PanelProps } from '@/panels/registry';
import { useWorkspace } from '@/stores/workspace';
import type { EditorPanel } from '@/workspace/types';
import { fileName } from './fileName';
import { primeLocal } from './useDocument';

// CodeMirror and its languages load with the first editor, not at startup.
const EditorPane = lazy(() => import('./EditorPane'));

function EditorLoader(props: PanelProps<EditorPanel>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          Chargement de l’éditeur…
        </div>
      }
    >
      <EditorPane {...props} />
    </Suspense>
  );
}

/** « Ouvrir un fichier… » : a local file picked in the native dialog, beside the active pane. */
async function openLocalFile(): Promise<void> {
  try {
    const opened = await editorOpenLocal();
    if (!opened) return;
    primeLocal(opened);
    const { tabs, activeTabId } = useWorkspace.getState();
    const beside = tabs.find((t) => t.id === activeTabId)?.activeLeafId ?? null;
    useWorkspace
      .getState()
      .openEditor(beside, { kind: 'local', docId: opened.docId, name: opened.name });
  } catch (err) {
    toast.error(isEditorError(err) ? err.message : String(err));
  }
}

export const editorModule: PanelModule<EditorPanel> = {
  id: 'core.editor',
  kind: 'editor',
  title: 'Éditeur',
  icon: FileCode,
  component: EditorLoader,
  tabTitle: (s) => fileName(s.source),
  // An editor is not restored after a restart: unsaved changes are confirmed on close.
  serialize: () => null,
  deserialize: () => null,
  commands: [
    {
      id: 'editor.openFile',
      title: 'Ouvrir un fichier…',
      group: 'Panneaux',
      run: () => void openLocalFile(),
    },
  ],
};
