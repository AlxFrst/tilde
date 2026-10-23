// Windows Terminal color schemes: a single scheme object, or a whole settings.json
// (JSON with comments and trailing commas) whose `schemes` array is read.

import { ANSI_KEYS, fail, normalizeHex, withDefaults, type RawScheme } from './common';

/** Removes `//` and `/* *\/` comments and trailing commas, leaving strings untouched. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === ',') {
      // A trailing comma (only blanks and comments before `}` or `]`) is dropped.
      const next = text[skipBlanksAndComments(text, i + 1)];
      if (next === '}' || next === ']') {
        i++;
        continue;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index of the first character at or after `i` that is not a blank or in a comment. */
function skipBlanksAndComments(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i++;
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else return i;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function scheme(raw: Record<string, unknown>): RawScheme {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Sans nom';
  const terminal: RawScheme['terminal'] = {
    foreground: normalizeHex(raw.foreground),
    background: normalizeHex(raw.background),
    cursor: normalizeHex(raw.cursorColor),
    selectionBackground: normalizeHex(raw.selectionBackground),
  };
  for (const k of ANSI_KEYS) {
    const wtKey = k === 'magenta' ? 'purple' : k === 'brightMagenta' ? 'brightPurple' : k;
    terminal[k] = normalizeHex(raw[wtKey] ?? raw[k]);
  }
  return { name, terminal: withDefaults(terminal) };
}

export function parseWindowsTerminal(text: string): RawScheme[] {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonc(text));
  } catch {
    fail('JSON invalide');
  }
  if (!isObject(data)) fail('JSON invalide : objet attendu');
  if (Array.isArray(data.schemes)) return data.schemes.filter(isObject).map(scheme);
  if ('background' in data || 'foreground' in data) return [scheme(data)];
  fail('Aucun jeu de couleurs Windows Terminal dans ce fichier');
}
