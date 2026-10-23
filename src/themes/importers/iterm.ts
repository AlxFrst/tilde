// iTerm2 `.itermcolors`: an XML property list of color dictionaries whose components
// are reals between 0 and 1.

import { ANSI_KEYS, fail, withDefaults, type RawScheme } from './common';
import type { TerminalColors } from '../types';

const NAMED: Record<string, keyof TerminalColors> = {
  'Foreground Color': 'foreground',
  'Background Color': 'background',
  'Cursor Color': 'cursor',
  'Cursor Text Color': 'cursorAccent',
  'Selection Color': 'selectionBackground',
};

const byte = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** Children of a plist `<dict>` as key → value element. */
function entries(dict: Element): Map<string, Element> {
  const out = new Map<string, Element>();
  const children = [...dict.children];
  for (let i = 0; i + 1 < children.length; i += 2) {
    const key = children[i];
    const value = children[i + 1];
    if (key?.tagName === 'key' && value) out.set(key.textContent.trim(), value);
  }
  return out;
}

function component(color: Map<string, Element>, name: string, key: string): number {
  const el = color.get(`${name} Component`);
  const v = el ? Number(el.textContent.trim()) : NaN;
  if (!Number.isFinite(v)) fail(`${key} : composante ${name} invalide`);
  return v;
}

function toHex(el: Element, key: string, withAlpha: boolean): string {
  if (el.tagName !== 'dict') fail(`${key} : couleur attendue`);
  const color = entries(el);
  const [r, g, b] = ['Red', 'Green', 'Blue'].map((c) => component(color, c, key));
  const hex = `#${byte(r ?? 0)}${byte(g ?? 0)}${byte(b ?? 0)}`;
  if (!withAlpha || !color.has('Alpha Component')) return hex;
  const a = component(color, 'Alpha', key);
  return a >= 1 ? hex : `${hex}${byte(a)}`;
}

export function parseIterm(text: string, name: string): RawScheme {
  // A plist has no business declaring entities; refusing them rules out expansion bombs.
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) {
    fail('Fichier iTerm2 refusé : il déclare des entités XML');
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    fail('Fichier iTerm2 illisible : XML invalide');
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    fail('Fichier iTerm2 illisible : XML invalide');
  }
  const root = doc.querySelector('plist > dict');
  if (!root) fail('Fichier iTerm2 illisible : pas de dictionnaire de couleurs');
  const colors = entries(root);
  const terminal: RawScheme['terminal'] = {};
  ANSI_KEYS.forEach((k, i) => {
    const el = colors.get(`Ansi ${i} Color`);
    if (!el) fail(`Ansi ${i} Color : couleur manquante`);
    terminal[k] = toHex(el, `Ansi ${i} Color`, false);
  });
  for (const [plistKey, k] of Object.entries(NAMED)) {
    const el = colors.get(plistKey);
    if (el) terminal[k] = toHex(el, plistKey, k === 'selectionBackground');
    else if (k === 'foreground' || k === 'background') fail(`${plistKey} : couleur manquante`);
  }
  return { name, terminal: withDefaults(terminal) };
}
