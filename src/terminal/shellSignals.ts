// What a shell or a program sends to say something needs the user: the end of a command
// (shell integration, OSC 133 / OSC 633), a notification (OSC 9, OSC 777) or the bell,
// and what Tilde does about it. Pure: TerminalView feeds the signals, ./notifier acts.
//
// Every text here comes from the remote side, so it is untrusted: shown as plain text,
// without control characters, and cut short.

import { t } from '@/i18n';
import type { Notifications } from '@/ipc/generated/settings';

/** The longest message shown, in characters. */
export const MAX_TEXT = 200;

/** What an OSC 133/633 sequence says: a command starts, or the last one ended. */
export type ShellMark = { kind: 'start' } | { kind: 'end'; exitCode: number | null };

/**
 * An OSC 133 (FinalTerm, fish 4…) or OSC 633 (VS Code) payload: `C` a command starts,
 * `D[;code]` it ended. Extra parameters (`C;cmdline_url=…`, `D;0;aid=…`) are ignored, and
 * the other marks (`A`/`B` around the prompt, VS Code's `E`, `P`…) say nothing: null.
 */
export function parseShellMark(data: string): ShellMark | null {
  const [mark, code] = data.split(';');
  if (mark === 'C') return { kind: 'start' };
  if (mark !== 'D') return null;
  const exitCode = code !== undefined && /^-?\d{1,10}$/.test(code) ? Number(code) : null;
  return { kind: 'end', exitCode };
}

/**
 * Control characters (which a notification would show as boxes or act on), bidi controls
 * (which could make a message read backwards), and line and paragraph separators.
 */
const UNSAFE = /[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu;

function clean(raw: string): string {
  return (
    raw
      .replace(UNSAFE, ' ')
      // Some Linux notification servers read the body as markup: no tag can get through.
      .replaceAll('<', '‹')
      .replaceAll('>', '›')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Remote text made safe to show: one line of plain text, at most `max` characters. */
export function cleanText(raw: string, max = MAX_TEXT): string {
  const chars = Array.from(clean(raw));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * OSC 9 (iTerm2, ConEmu): `9;<text>` shows the text. ConEmu's numbered sub-commands
 * (`9;4;…` progress, `9;9;…` working directory…) are not messages: null, like empty text.
 */
export function parseOsc9(data: string): string | null {
  if (/^\d+(;|$)/.test(data)) return null;
  return cleanText(data) || null;
}

/** OSC 777 (urxvt, WezTerm, Ghostty): `777;notify;<title>;<body>`. Other verbs: null. */
export function parseOsc777(data: string): string | null {
  const [verb, title = '', ...body] = data.split(';');
  if (verb !== 'notify') return null;
  const parts = [clean(title), clean(body.join(';'))].filter((p) => p !== '');
  return parts.length > 0 ? cleanText(parts.join(' — ')) : null;
}

/** How long a command ran: « 42 s », « 2 min 13 s », « 1 h 5 min ». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${String(h)} h ${String(m)} min` : `${String(h)} h`;
  if (m > 0) return s > 0 ? `${String(m)} min ${String(s)} s` : `${String(m)} min`;
  return `${String(s)} s`;
}

/** « Commande terminée en 2 min 13 s », or failed with its code (no code: it succeeded). */
export function commandMessage(exitCode: number | null, ms: number): string {
  const duration = formatDuration(ms);
  return exitCode === null || exitCode === 0
    ? t('Commande terminée en {duration}', { duration })
    : t('Commande échouée (code {code}) en {duration}', { code: exitCode, duration });
}

export interface CommandTimer {
  /** A mark arrived at `now` (ms): the message of a command that ran at least `minSecs`. */
  mark: (mark: ShellMark, now: number, minSecs: number) => string | null;
  /** Forgets the command running (its shell is gone). */
  reset: () => void;
}

/**
 * Times the commands of one shell. Shells send `D` before every prompt, also after an
 * empty line or Ctrl+C at the prompt: only a `D` after a `C` ends a command.
 */
export function createCommandTimer(): CommandTimer {
  let started: number | null = null;
  return {
    mark: (mark, now, minSecs) => {
      if (mark.kind === 'start') {
        started = now;
        return null;
      }
      if (started === null) return null;
      const ms = now - started;
      started = null;
      return ms >= minSecs * 1000 ? commandMessage(mark.exitCode, ms) : null;
    },
    reset: () => {
      started = null;
    },
  };
}

/**
 * `true` at most once every `intervalMs`: a program ringing the bell or printing OSC 9 in
 * a loop must not flood the desktop with notifications.
 */
export function createRateLimit(intervalMs: number): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}

/** Where the session is, when the signal arrives. */
export interface Exposure {
  /** The Tilde window has the focus. */
  windowFocused: boolean;
  /** The session is shown: the active one, or in the side-by-side view shown. */
  onScreen: boolean;
}

export interface Reaction {
  /** Marks the session in the Rail. */
  badge: boolean;
  /** A system notification. */
  notify: boolean;
  /** Flashes the window in the taskbar. */
  attention: boolean;
}

const NOTHING: Reaction = { badge: false, notify: false, attention: false };

/**
 * What a signal does. In a session the user is looking at (window focused, session on
 * screen): nothing. Otherwise the Rail marks it, and unless turned off a system
 * notification says why, the taskbar flashing too if Tilde is in the background.
 */
export function react(signal: 'bell' | 'message', where: Exposure, prefs: Notifications): Reaction {
  if (where.windowFocused && where.onScreen) return NOTHING;
  const notify = prefs.enabled && (signal !== 'bell' || prefs.onBell);
  return { badge: true, notify, attention: notify && !where.windowFocused };
}
