import { create } from 'zustand';

/** What the rest of the app needs to know about an open editor. */
export interface EditorDoc {
  /** File name, for close confirmations. */
  name: string;
  /** Changed since the last save. */
  dirty: boolean;
  /** The current text (previews follow it live). */
  text: string;
}

interface EditorsState {
  /** By editor pane (leaf id). */
  docs: Record<string, EditorDoc>;
  set: (leafId: string, patch: Partial<EditorDoc>) => void;
  forget: (leafId: string) => void;
}

export const useEditors = create<EditorsState>()((set) => ({
  docs: {},
  set: (leafId, patch) => {
    set((s) => ({
      docs: {
        ...s.docs,
        [leafId]: { name: '', dirty: false, text: '', ...s.docs[leafId], ...patch },
      },
    }));
  },
  forget: (leafId) => {
    set((s) => ({
      docs: Object.fromEntries(Object.entries(s.docs).filter(([id]) => id !== leafId)),
    }));
  },
}));

/** Names of the files with unsaved changes among these panes (all panes by default). */
export function dirtyEditors(leafIds?: readonly string[]): string[] {
  const { docs } = useEditors.getState();
  const ids = leafIds ?? Object.keys(docs);
  return ids.flatMap((id) => {
    const d = docs[id];
    return d?.dirty ? [d.name] : [];
  });
}
