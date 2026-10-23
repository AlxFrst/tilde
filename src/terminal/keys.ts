// Built-in keyboard shortcuts. Phase 6 makes them configurable; keep the ids stable.

export type CommandId =
  | 'tab.new'
  | 'tab.close'
  | 'tab.next'
  | 'tab.prev'
  | 'pane.splitRight'
  | 'pane.splitDown'
  | 'pane.close'
  | 'pane.focusLeft'
  | 'pane.focusRight'
  | 'pane.focusUp'
  | 'pane.focusDown'
  | 'terminal.copy'
  | 'terminal.paste'
  | 'terminal.search'
  | 'ssh.quickConnect';

export const DEFAULT_KEYBINDINGS: Record<CommandId, string> = {
  'tab.new': 'Ctrl+Shift+T',
  'tab.close': 'Ctrl+Shift+W',
  'tab.next': 'Ctrl+Tab',
  'tab.prev': 'Ctrl+Shift+Tab',
  'pane.splitRight': 'Alt+Shift+=',
  'pane.splitDown': 'Alt+Shift+-',
  'pane.close': 'Ctrl+Shift+X',
  'pane.focusLeft': 'Alt+ArrowLeft',
  'pane.focusRight': 'Alt+ArrowRight',
  'pane.focusUp': 'Alt+ArrowUp',
  'pane.focusDown': 'Alt+ArrowDown',
  'terminal.copy': 'Ctrl+Shift+C',
  'terminal.paste': 'Ctrl+Shift+V',
  'terminal.search': 'Ctrl+Shift+F',
  'ssh.quickConnect': 'Ctrl+Shift+K',
};

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
>;

interface Binding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  code: string;
}

const SYMBOL_CODES: Record<string, string> = {
  '=': 'Equal',
  '-': 'Minus',
  ',': 'Comma',
  '.': 'Period',
};

/** Maps the key part of a binding to a physical `KeyboardEvent.code`, so shortcuts
 *  don't depend on the keyboard layout (AZERTY…). */
function keyToCode(key: string): string {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return SYMBOL_CODES[key] ?? key;
}

function parse(binding: string): Binding {
  const parts = binding.split('+');
  // "Alt+Shift+=" splits cleanly; a binding ending in "+" itself would need care.
  const key = parts.pop() ?? '';
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    code: keyToCode(key),
  };
}

const PARSED = Object.entries(DEFAULT_KEYBINDINGS).map(
  ([id, b]) => [id as CommandId, parse(b)] as const,
);

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Characters produced by the shifted Equal/Minus keys on common layouts. */
const SHIFTED_SYMBOLS: Record<string, string> = { '+': 'Equal', _: 'Minus' };

/** The code a key *character* corresponds to (`+` → Equal, `ArrowLeft` → ArrowLeft…). */
const codeFromKey = (key: string) => SHIFTED_SYMBOLS[key] ?? keyToCode(key);

/**
 * The command bound to this key event, if any. On macOS, `Ctrl` in a binding means ⌘.
 *
 * Letters match the printed character; other keys match the physical key first, then the
 * produced character (numpad `+`/`-`, arrows reported as numpad keys, and sources that
 * leave `code` empty: remote desktop, automation, some IMEs).
 */
export function matchShortcut(e: KeyEventLike, mac = isMac()): CommandId | null {
  const ctrl = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (otherMod) return null;
  // Letters follow the printed character (Ctrl+Shift+W is the key labelled W, even on
  // AZERTY); everything else follows the physical key, then the character.
  const latinLetter = /^[a-z]$/i.test(e.key);
  const candidates = latinLetter
    ? [keyToCode(e.key)]
    : [e.code, codeFromKey(e.key)].filter((c) => c && c !== 'Unidentified');
  for (const code of candidates) {
    for (const [id, b] of PARSED) {
      if (b.code === code && b.ctrl === ctrl && b.shift === e.shiftKey && b.alt === e.altKey) {
        return id;
      }
    }
  }
  return null;
}

/** The physical `KeyboardEvent.code` of a binding's key, e.g. `Minus` for `Alt+Shift+-`. */
export function bindingCode(id: CommandId): string {
  return parse(DEFAULT_KEYBINDINGS[id]).code;
}
