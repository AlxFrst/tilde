// A CodeMirror 6 editor with Tilde's defaults. Language and theme live in compartments
// so they change without recreating the editor (and losing undo history).

import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

export interface EditorHandle {
  view: EditorView;
  /** Replaces the whole text (reload), as one undoable change. */
  setDoc: (text: string) => void;
  setTheme: (theme: Extension) => void;
  setLanguage: (language: Extension | null) => void;
  destroy: () => void;
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  language: Extension | null;
  theme: Extension;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}): EditorHandle {
  const language = new Compartment();
  const theme = new Compartment();
  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: false }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorState.readOnly.of(opts.readOnly ?? false),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              opts.onSave();
              return true;
            },
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
        language.of(opts.language ?? []),
        theme.of(opts.theme),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    setDoc: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setTheme: (ext) => {
      view.dispatch({ effects: theme.reconfigure(ext) });
    },
    setLanguage: (ext) => {
      view.dispatch({ effects: language.reconfigure(ext ?? []) });
    },
    destroy: () => {
      view.destroy();
    },
  };
}
