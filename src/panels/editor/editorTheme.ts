// The editor follows the active Tilde theme: UI tokens for the chrome, the terminal's
// ANSI palette for syntax colours (so a theme looks the same in both).

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { ThemeDefinition } from '@/themes';

export function highlightStyleFor(theme: ThemeDefinition): HighlightStyle {
  const c = theme.terminal;
  return HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: c.magenta },
    { tag: [t.string, t.special(t.string), t.regexp], color: c.green },
    { tag: [t.number, t.bool, t.null, t.atom], color: c.yellow },
    {
      tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: c.brightBlack,
      fontStyle: 'italic',
    },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: c.blue },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: c.cyan },
    { tag: [t.propertyName, t.attributeName], color: c.foreground },
    { tag: [t.definition(t.variableName), t.labelName], color: c.brightBlue },
    { tag: [t.heading], color: c.blue, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: c.cyan, textDecoration: 'underline' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: 'bold' },
    { tag: [t.invalid], color: c.red },
    { tag: [t.meta, t.processingInstruction], color: c.brightBlack },
  ]);
}

export function editorTheme(
  theme: ThemeDefinition,
  font: { family: string; size: number },
): Extension {
  const { ui, terminal } = theme;
  const view = EditorView.theme(
    {
      '&': {
        height: '100%',
        color: ui.text,
        backgroundColor: ui.bg,
        fontSize: `${String(font.size)}px`,
      },
      '.cm-scroller': {
        fontFamily: `"${font.family}", "JetBrains Mono Variable", ui-monospace, monospace`,
        lineHeight: '1.5',
      },
      '.cm-content': { caretColor: terminal.cursor },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: terminal.cursor },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
        { backgroundColor: terminal.selectionBackground },
      '.cm-gutters': {
        backgroundColor: ui.surface1,
        color: ui.textMuted,
        borderRight: `1px solid ${ui.border}`,
      },
      '.cm-activeLine': { backgroundColor: `${ui.surface2.slice(0, 7)}66` },
      '.cm-activeLineGutter': { backgroundColor: ui.surface2, color: ui.text },
      '.cm-matchingBracket': { outline: `1px solid ${ui.accent}` },
      '.cm-searchMatch': { backgroundColor: `${ui.warning.slice(0, 7)}40` },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: `${ui.accent.slice(0, 7)}55` },
      '.cm-panels': { backgroundColor: ui.surface1, color: ui.text },
      '.cm-panels input, .cm-panels button': { color: ui.text },
      '.cm-tooltip': { backgroundColor: ui.surface2, border: `1px solid ${ui.border}` },
    },
    { dark: theme.kind === 'dark' },
  );
  return [view, syntaxHighlighting(highlightStyleFor(theme))];
}
