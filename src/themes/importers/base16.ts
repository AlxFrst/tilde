// base16 / base24 schemes (YAML). Only flat `key: value` lines are read, which covers
// both the classic format and tinted-theming's `palette:` block.

import { ANSI_KEYS, fail, normalizeHex, type RawScheme } from './common';

/** Standard base16-shell mapping of base00–base0F onto the 16 ANSI colors. */
const ANSI_FROM_BASE = [
  '00',
  '08',
  '0B',
  '0A',
  '0D',
  '0E',
  '0C',
  '05',
  '03',
  '08',
  '0B',
  '0A',
  '0D',
  '0E',
  '0C',
  '07',
] as const;

export function looksLikeBase16(text: string): boolean {
  return /^\s*base00\s*:/m.test(text);
}

export function parseBase16(text: string): RawScheme {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m?.[1]) continue;
    let value = m[2] ?? '';
    const quoted = /^(["'])(.*)\1/.exec(value);
    if (quoted) value = quoted[2] ?? '';
    else value = value.replace(/\s+#.*$/, '');
    values.set(m[1].toLowerCase(), value);
  }
  const base = (n: string) => {
    const hex = normalizeHex(values.get(`base${n.toLowerCase()}`));
    if (!hex) fail(`base${n} : couleur manquante ou invalide (fichier base16 attendu)`);
    return hex;
  };
  const name = values.get('scheme') || values.get('name') || 'base16';
  const terminal: RawScheme['terminal'] = {
    foreground: base('05'),
    background: base('00'),
    cursor: base('05'),
    cursorAccent: base('00'),
    selectionBackground: `${base('02')}60`,
  };
  ANSI_KEYS.forEach((k, i) => {
    terminal[k] = base(ANSI_FROM_BASE[i] ?? '00');
  });
  return { name, terminal };
}
