// Keyboard shortcuts: the default bindings and the matcher. The effective table
// (defaults + keybindings.json) comes from the keybindings store.
//
// Syntax: modifiers `Ctrl`, `Alt`, `Shift` then one key, joined by `+`
// (`Ctrl+Shift+T`, `Alt+ArrowLeft`, `F11`). On macOS `Ctrl` means ⌘.

/** Built-in shortcuts by command id. Keep the ids stable: keybindings.json uses them. */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = {
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
  'palette.toggle': 'Ctrl+Shift+P',
  'sftp.open': 'Ctrl+Shift+E',
  'library.open': 'Ctrl+Shift+L',
  'sidebar.toggle': 'Ctrl+Shift+B',
  'space.next': 'Ctrl+Shift+PageDown',
  'space.prev': 'Ctrl+Shift+PageUp',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`space.${String(i + 1)}`, `Ctrl+Shift+${String(i + 1)}`]),
  ),
};

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
>;

export interface Binding {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The key as written in a binding (`T`, `-`, `ArrowLeft`, `F5`). */
  key: string;
  /** Its physical `KeyboardEvent.code` (`KeyT`, `Minus`…). */
  code: string;
}

/** Command id → parsed binding, in priority order. */
export type BindingTable = ReadonlyMap<string, Binding>;

const SYMBOL_CODES: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};
const CODE_SYMBOLS = Object.fromEntries(Object.entries(SYMBOL_CODES).map(([k, c]) => [c, k]));

/** Named keys, whose code is their name. */
const NAMED = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Tab',
  'Enter',
  'Escape',
  'Space',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
];
const NAMED_LOWER = new Map(NAMED.map((n) => [n.toLowerCase(), n]));

/** The canonical key token and its code, or null if the key is not supported. */
function keyToken(raw: string): { key: string; code: string } | null {
  if (/^[a-z]$/i.test(raw)) return { key: raw.toUpperCase(), code: `Key${raw.toUpperCase()}` };
  if (/^[0-9]$/.test(raw)) return { key: raw, code: `Digit${raw}` };
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(raw);
  if (f) return { key: `F${f[1] ?? ''}`, code: `F${f[1] ?? ''}` };
  const symbol = SYMBOL_CODES[raw];
  if (symbol) return { key: raw, code: symbol };
  const named = NAMED_LOWER.get(raw.toLowerCase());
  return named ? { key: named, code: named } : null;
}

/** Parses `Ctrl+Shift+T`; `null` if the syntax or the key is unknown. */
export function parseBinding(s: string): Binding | null {
  const parts = s.trim().split('+');
  const last = parts.pop();
  if (!last) return null;
  const token = keyToken(last.trim());
  if (!token) return null;
  const b: Binding = { ctrl: false, alt: false, shift: false, ...token };
  for (const raw of parts) {
    const m = raw.trim().toLowerCase();
    if (m === 'ctrl' || m === 'control') b.ctrl = true;
    else if (m === 'alt') b.alt = true;
    else if (m === 'shift') b.shift = true;
    else return null;
  }
  return b;
}

/** The canonical form: `Ctrl+Alt+Shift+<Key>`. */
export function formatBinding(b: Binding): string {
  return [b.ctrl && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', b.key].filter(Boolean).join('+');
}

/** A key alone would break typing in the terminal; only function keys may go without. */
export function requiresModifier(b: Binding): boolean {
  return !/^F\d+$/.test(b.key);
}

/** The match table for the effective bindings (`null` = unbound; unparsable = skipped). */
export function compileBindings(effective: Readonly<Record<string, string | null>>): BindingTable {
  const table = new Map<string, Binding>();
  for (const [id, s] of Object.entries(effective)) {
    const b = s === null ? null : parseBinding(s);
    if (b) table.set(id, b);
  }
  return table;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Characters produced by the shifted Equal/Minus keys on common layouts. */
const SHIFTED_SYMBOLS: Record<string, string> = { '+': 'Equal', _: 'Minus' };

/** The code a key *character* corresponds to (`+` → Equal, `ArrowLeft` → ArrowLeft…). */
const codeFromKey = (key: string) => SHIFTED_SYMBOLS[key] ?? keyToken(key)?.code ?? key;

/**
 * The command bound to this key event, if any. On macOS, `Ctrl` in a binding means ⌘.
 *
 * Letters match the printed character; other keys match the physical key first, then the
 * produced character (numpad `+`/`-`, arrows reported as numpad keys, and sources that
 * leave `code` empty: remote desktop, automation, some IMEs).
 */
export function matchShortcut(e: KeyEventLike, table: BindingTable, mac = isMac()): string | null {
  const ctrl = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (otherMod) return null;
  // Letters follow the printed character (Ctrl+Shift+W is the key labelled W, even on
  // AZERTY); everything else follows the physical key, then the character.
  const latinLetter = /^[a-z]$/i.test(e.key);
  const candidates = latinLetter
    ? [`Key${e.key.toUpperCase()}`]
    : [e.code, codeFromKey(e.key)].filter((c) => c && c !== 'Unidentified');
  for (const code of candidates) {
    for (const [id, b] of table) {
      if (b.code === code && b.ctrl === ctrl && b.shift === e.shiftKey && b.alt === e.altKey) {
        return id;
      }
    }
  }
  return null;
}

/**
 * Ctrl+C with a selection copies it and Ctrl+V pastes, as in Windows Terminal; Ctrl+C
 * without a selection still reaches the shell (interrupt). Not on macOS, where ⌘C/⌘V do
 * this and Ctrl+C must always interrupt.
 */
export function clipboardKey(
  e: KeyEventLike,
  hasSelection: boolean,
  mac = isMac(),
): 'copy' | 'paste' | null {
  if (mac || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'c' && hasSelection) return 'copy';
  if (k === 'v') return 'paste';
  return null;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/**
 * The binding a key press records, in canonical form; `null` for a lone modifier or an
 * unsupported key. Letters are recorded by printed character, other keys by physical key
 * (on AZERTY, Alt+Shift+`)` records `Alt+Shift+-`, which is how it will match).
 */
export function eventToBinding(e: KeyEventLike, mac = isMac()): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string | undefined;
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else key = CODE_SYMBOLS[e.code] ?? NAMED_LOWER.get(e.code.toLowerCase());
  if (!key) return null;
  const b = parseBinding(key);
  if (!b) return null;
  b.ctrl = mac ? e.metaKey : e.ctrlKey;
  b.alt = e.altKey;
  b.shift = e.shiftKey;
  return formatBinding(b);
}

/** The physical `KeyboardEvent.code` of a binding's key, e.g. `Minus` for `Alt+Shift+-`. */
export function bindingCode(binding: string): string | null {
  return parseBinding(binding)?.code ?? null;
}
