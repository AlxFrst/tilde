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
import { useLocale } from '@/i18n';

export interface EditorHandle {
  view: EditorView;
  /** Replaces the whole text (reload), as one undoable change. */
  setDoc: (text: string) => void;
  setTheme: (theme: Extension) => void;
  setLanguage: (language: Extension | null) => void;
  destroy: () => void;
}

/** The line ending most of the file uses (`\n` for a file without any). */
export function detectLineEnding(text: string): '\r\n' | '\n' {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

export interface EditorOptions {
  doc: string;
  language: Extension | null;
  theme: Extension;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}

const language = new Compartment();
const theme = new Compartment();

/** CodeMirror's own words (search panel, folding…) in French; English is its default. */
const FRENCH_PHRASES: Record<string, string> = {
  // @codemirror/view, @codemirror/commands
  'Control character': 'Caractère de contrôle',
  'Selection deleted': 'Sélection supprimée',
  // @codemirror/language
  'Folded lines': 'Lignes repliées',
  'Unfolded lines': 'Lignes dépliées',
  to: 'à',
  'folded code': 'code replié',
  unfold: 'déplier',
  'Fold line': 'Replier la ligne',
  'Unfold line': 'Déplier la ligne',
  // @codemirror/search
  'Go to line': 'Aller à la ligne',
  go: 'OK',
  Find: 'Rechercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'respecter la casse',
  'by word': 'mot entier',
  regexp: 'expression régulière',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'current match': 'occurrence courante',
  'on line': 'à la ligne',
  'replaced match on line $': 'occurrence remplacée à la ligne $',
  'replaced $ matches': '$ occurrences remplacées',
  // @codemirror/autocomplete
  Completions: 'Complétions',
};

/**
 * The editor state. The file's own line ending is kept: CodeMirror would otherwise
 * write every line back with `\n` (rewriting a Windows file on save).
 */
export function createEditorState(opts: EditorOptions): EditorState {
  return EditorState.create({
    doc: opts.doc,
    extensions: [
      EditorState.lineSeparator.of(detectLineEnding(opts.doc)),
      // The interface's language when the editor is created.
      useLocale.getState().locale === 'fr' ? EditorState.phrases.of(FRENCH_PHRASES) : [],
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
        // sliceDoc() joins lines with the file's own line ending; doc.toString() does not.
        if (u.docChanged) opts.onChange(u.state.sliceDoc());
      }),
    ],
  });
}

export function createEditor(opts: EditorOptions & { parent: HTMLElement }): EditorHandle {
  const view = new EditorView({ parent: opts.parent, state: createEditorState(opts) });
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
