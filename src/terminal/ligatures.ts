// Ligatures in xterm: a character joiner marks the sequences the WebGL renderer must draw
// as one string, so the font's ligature shows. (@xterm/addon-ligatures reads font files
// through Node.js, which a webview does not have.) The DOM renderer ignores joiners.

import type { Terminal } from '@xterm/xterm';

/** Sequences JetBrains Mono / Fira Code draw as ligatures, longest first. */
export const LIGATURES: readonly string[] = [
  '<!--',
  '===',
  '!==',
  '<=>',
  '...',
  '->',
  '=>',
  '<-',
  '<=',
  '>=',
  '==',
  '!=',
  '::',
  '&&',
  '||',
  '++',
  '//',
  '/*',
  '*/',
  '..',
  '|>',
  '<|',
  '>>',
  '<<',
  '??',
  '?.',
  ':=',
  'www',
].sort((a, b) => b.length - a.length);

/** `[start, end)` ranges of ligatures in `text`, without overlap, longest match first. */
export function ligatureRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const hit = LIGATURES.find((l) => text.startsWith(l, i));
    if (hit) {
      ranges.push([i, i + hit.length]);
      i += hit.length;
    } else i++;
  }
  return ranges;
}

/** Turns ligatures on; the returned function turns them off. */
export function enableLigatures(
  term: Pick<Terminal, 'registerCharacterJoiner' | 'deregisterCharacterJoiner'>,
): () => void {
  const id = term.registerCharacterJoiner(ligatureRanges);
  return () => {
    term.deregisterCharacterJoiner(id);
  };
}
