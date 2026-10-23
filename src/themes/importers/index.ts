// Imports color schemes from other terminals into Tilde themes.

import { parseThemeFile, ThemeError } from '../parse';
import type { ThemeDefinition } from '../types';
import { parseBase16, looksLikeBase16 } from './base16';
import { fail, type RawScheme } from './common';
import { parseIterm } from './iterm';
import { parseWindowsTerminal, stripJsonc } from './windowsTerminal';

export interface ImportResult {
  themes: ThemeDefinition[];
  /** Schemes of the file that could not be used, one line each. */
  warnings: string[];
}

export const MAX_IMPORT_CHARS = 1024 * 1024;

/** A theme id from a display name: `[a-z0-9-]`, at most 64 characters, never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug || 'theme';
}

type Format = 'iterm' | 'wt' | 'base16';

function detect(fileName: string, text: string): Format {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'itermcolors') return 'iterm';
  if (ext === 'json') return 'wt';
  if (ext === 'yaml' || ext === 'yml') return 'base16';
  const head = text.trimStart();
  if (head.startsWith('<')) return 'iterm';
  if (head.startsWith('{') || head.startsWith('//')) return 'wt';
  if (looksLikeBase16(text)) return 'base16';
  fail('Format non reconnu : .itermcolors, JSON Windows Terminal ou YAML base16 attendus');
}

/** A Tilde theme file (what « Exporter » writes), if `text` is one. */
function tildeTheme(text: string): ThemeDefinition | null {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonc(text));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.terminal !== 'object' || record.terminal === null) return null;
  const name = typeof record.name === 'string' ? record.name : '';
  return parseThemeFile(record, slugify(name));
}

function toTheme(raw: RawScheme): ThemeDefinition {
  return parseThemeFile({ name: raw.name, terminal: raw.terminal }, slugify(raw.name));
}

/**
 * Reads an iTerm2, Windows Terminal or base16 file. Missing UI tokens are derived.
 *
 * @throws {ThemeError} when nothing usable is found.
 */
export function importTheme(fileName: string, text: string): ImportResult {
  if (text.length > MAX_IMPORT_CHARS) fail('Fichier trop volumineux (1 Mio au plus)');
  const format = detect(fileName, text);
  if (format === 'wt') {
    const own = tildeTheme(text);
    if (own) return { themes: [own], warnings: [] };
  }
  const baseName = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '') || 'Importé';
  const schemes =
    format === 'iterm'
      ? [parseIterm(text, baseName)]
      : format === 'base16'
        ? [parseBase16(text)]
        : parseWindowsTerminal(text);
  const themes: ThemeDefinition[] = [];
  const warnings: string[] = [];
  for (const s of schemes) {
    try {
      themes.push(toTheme(s));
    } catch (e) {
      if (!(e instanceof ThemeError)) throw e;
      if (schemes.length === 1) throw e;
      warnings.push(`${s.name} : ${e.message}`);
    }
  }
  if (themes.length === 0) fail('Aucun thème utilisable dans ce fichier');
  return { themes, warnings };
}
