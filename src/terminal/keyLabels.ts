import { bindingCode } from './keys';

const MODIFIER_LABELS: Record<string, string> = { Ctrl: 'Ctrl', Shift: 'Maj', Alt: 'Alt' };
const ARROWS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** A binding as keycaps, e.g. `['Alt', 'Maj', '-']` (US layout labels). */
export function bindingKeys(binding: string): string[] {
  const parts = binding.split('+');
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
 * Keycaps for each binding, with the main key labelled as printed on the user's keyboard
 * (shortcuts match physical keys: on AZERTY, "Alt+Maj+-" is pressed on the `)` key).
 */
export async function resolveKeyLabels(
  bindings: string[],
  keyboard: LayoutSource | undefined = browserKeyboard(),
): Promise<Record<string, string[]>> {
  const layout = keyboard ? await keyboard.getLayoutMap().catch(() => null) : null;
  const out: Record<string, string[]> = {};
  for (const binding of bindings) {
    const keys = bindingKeys(binding);
    const code = bindingCode(binding);
    // Letter shortcuts match the printed letter, so their label never changes.
    const printed = !code || code.startsWith('Key') ? undefined : layout?.get(code);
    if (printed?.trim()) keys[keys.length - 1] = printed.toUpperCase();
    out[binding] = keys;
  }
  return out;
}
