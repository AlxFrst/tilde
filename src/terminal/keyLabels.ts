import { bindingCode, DEFAULT_KEYBINDINGS, type CommandId } from './keys';

const MODIFIER_LABELS: Record<string, string> = { Ctrl: 'Ctrl', Shift: 'Maj', Alt: 'Alt' };
const ARROWS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** A binding as keycaps, e.g. `['Alt', 'Maj', '-']` (US layout labels). */
export function bindingKeys(id: CommandId): string[] {
  const parts = DEFAULT_KEYBINDINGS[id].split('+');
  const key = parts.pop() ?? '';
  return [...parts.map((m) => MODIFIER_LABELS[m] ?? m), ARROWS[key] ?? key];
}

interface LayoutSource {
  getLayoutMap(): Promise<Map<string, string>>;
}

/** Chromium's Keyboard API (available in WebView2), when present. */
function browserKeyboard(): LayoutSource | undefined {
  return (navigator as Navigator & { keyboard?: LayoutSource }).keyboard;
}

/**
 * Keycaps for each command, with the main key labelled as printed on the user's keyboard
 * (shortcuts match physical keys: on AZERTY, "Alt+Maj+-" is pressed on the `)` key).
 */
export async function resolveKeyLabels(
  ids: CommandId[],
  keyboard: LayoutSource | undefined = browserKeyboard(),
): Promise<Partial<Record<CommandId, string[]>>> {
  const layout = keyboard ? await keyboard.getLayoutMap().catch(() => null) : null;
  const out: Partial<Record<CommandId, string[]>> = {};
  for (const id of ids) {
    const keys = bindingKeys(id);
    const code = bindingCode(id);
    // Letter shortcuts match the printed letter, so their label never changes.
    const printed = code.startsWith('Key') ? undefined : layout?.get(code);
    if (printed && printed.trim()) keys[keys.length - 1] = printed.toUpperCase();
    out[id] = keys;
  }
  return out;
}
