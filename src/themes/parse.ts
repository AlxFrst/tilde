// Validation of theme files (`themes/<id>.json`, imports): every color is checked and
// missing UI tokens are derived from the terminal palette.

import { t } from '@/i18n';
import { deriveUiTokens, inferKind } from './derive';
import type { TerminalColors, ThemeDefinition, ThemeKind, UiTokens } from './types';

export const THEME_FILE_VERSION = 1;

/** A theme that cannot be used; the message names the faulty field, in the interface's language. */
export class ThemeError extends Error {
  override name = 'ThemeError';
}

const UI_KEYS: readonly (keyof UiTokens)[] = [
  'bg',
  'surface1',
  'surface2',
  'border',
  'text',
  'textMuted',
  'accent',
  'accent2',
  'success',
  'warning',
  'error',
];

export const TERMINAL_KEYS: readonly (keyof TerminalColors)[] = [
  'foreground',
  'background',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX6_8 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function color(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ThemeError(t('{field} : couleur invalide (attendu #RRGGBB)', { field }));
  }
  return value;
}

/**
 * Reads a theme file. `fallbackId` (the file name) wins over the `id` it contains.
 *
 * @throws {ThemeError} when a field is missing or invalid.
 */
export function parseThemeFile(raw: unknown, fallbackId?: string): ThemeDefinition {
  if (!isObject(raw)) throw new ThemeError(t('Le thème doit être un objet JSON'));
  if (typeof raw.version === 'number' && raw.version > THEME_FILE_VERSION) {
    throw new ThemeError(t('version : thème créé par une version plus récente de Tilde'));
  }
  const id = fallbackId ?? raw.id;
  if (typeof id !== 'string' || !ID.test(id)) {
    throw new ThemeError(t('id : lettres minuscules, chiffres et tirets uniquement'));
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 80)
    throw new ThemeError(t('name : nom requis (80 caractères au plus)'));
  if (!isObject(raw.terminal))
    throw new ThemeError(t('terminal : couleurs du terminal manquantes'));
  const source = raw.terminal;
  const terminal = Object.fromEntries(
    TERMINAL_KEYS.map((k) => [k, color(source[k], `terminal.${k}`, HEX6_8)]),
  ) as unknown as TerminalColors;
  let kind: ThemeKind;
  if (raw.kind === undefined) kind = inferKind(terminal.background.slice(0, 7));
  else if (raw.kind === 'dark' || raw.kind === 'light') kind = raw.kind;
  else throw new ThemeError(t('kind : « dark » ou « light »'));
  const ui = deriveUiTokens(terminal);
  if (raw.ui !== undefined) {
    if (!isObject(raw.ui)) throw new ThemeError(t('ui : doit être un objet'));
    for (const k of UI_KEYS) {
      if (raw.ui[k] !== undefined) ui[k] = color(raw.ui[k], `ui.${k}`, HEX6);
    }
  }
  return { id, name, kind, ui, terminal };
}

/** The `themes/<id>.json` form of a theme. */
export function serializeTheme(t: ThemeDefinition): string {
  const { id, name, kind, ui, terminal } = t;
  return `${JSON.stringify({ version: THEME_FILE_VERSION, id, name, kind, ui, terminal }, null, 2)}\n`;
}
