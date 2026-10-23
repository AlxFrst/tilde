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
  | 'terminal.search';

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

/** The command bound to this key event, if any. On macOS, `Ctrl` in a binding means ⌘. */
export function matchShortcut(e: KeyEventLike, mac = isMac()): CommandId | null {
  const ctrl = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (otherMod) return null;
  for (const [id, b] of PARSED) {
    if (b.code === e.code && b.ctrl === ctrl && b.shift === e.shiftKey && b.alt === e.altKey) {
      return id;
    }
  }
  return null;
}
