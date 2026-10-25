import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { tRust } from '@/i18n/rust';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import {
  keybindingsGet,
  keybindingsReset,
  keybindingsSet,
  onKeybindingsChanged,
  onKeybindingsError,
  type KeybindingsSnapshot,
} from '@/ipc/keybindings';
import {
  compileBindings,
  DEFAULT_KEYBINDINGS,
  formatBinding,
  parseBinding,
  requiresModifier,
  type BindingTable,
} from '@/terminal/keys';

interface KeybindingsState {
  /** What keybindings.json says (changes to the defaults only). */
  overrides: Record<string, string | null>;
  /** Defaults + valid overrides: command id → shortcut, or `null` when unbound. */
  effective: Record<string, string | null>;
  /** `effective`, ready for matching key events. */
  table: BindingTable;
  /** Commands whose override in keybindings.json cannot be parsed (default kept). */
  invalid: string[];
  readOnly: boolean;
  /** Loads keybindings.json and follows changes; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
  /** `null` unbinds. `false` (with a toast) when the backend refuses. */
  set: (command: string, binding: string | null) => Promise<boolean>;
  /** Back to the default for `command`, or for every command. */
  reset: (command?: string) => Promise<boolean>;
}

function compute(overrides: Record<string, string | null>) {
  const effective: Record<string, string | null> = { ...DEFAULT_KEYBINDINGS };
  const invalid: string[] = [];
  for (const [id, binding] of Object.entries(overrides)) {
    if (binding === null) {
      effective[id] = null;
      continue;
    }
    const parsed = parseBinding(binding);
    // A key without Ctrl or Alt would fire on every keystroke typed in the terminal.
    const typing = parsed && requiresModifier(parsed) && !parsed.ctrl && !parsed.alt;
    if (parsed && !typing) effective[id] = formatBinding(parsed);
    else invalid.push(id);
  }
  return { overrides, effective, invalid, table: compileBindings(effective) };
}

/** One sentence per shortcut used by several commands (only the first one fires). */
function duplicates(effective: Record<string, string | null>): string[] {
  const byBinding = new Map<string, string[]>();
  for (const [id, b] of Object.entries(effective)) {
    if (b) byBinding.set(b, [...(byBinding.get(b) ?? []), id]);
  }
  return [...byBinding]
    .filter(([, ids]) => ids.length > 1)
    .map(([b, ids]) =>
      t('{binding} est attribué à plusieurs commandes ({ids})', {
        binding: b,
        ids: ids.join(', '),
      }),
    );
}

function describe(err: unknown): string {
  if (isConfigError(err)) return formatConfigError(err, 'keybindings.json');
  return typeof err === 'string' ? err : t('Erreur inattendue');
}

export const useKeybindings = create<KeybindingsState>()((set, get) => {
  let shownWarnings = new Set<string>();

  const apply = (s: KeybindingsSnapshot) => {
    const next = compute(s.bindings);
    const before = new Set(get().invalid.map((id) => `${id}=${get().overrides[id] ?? ''}`));
    for (const id of next.invalid) {
      if (before.has(`${id}=${s.bindings[id] ?? ''}`)) continue;
      toast.error(
        t(
          'keybindings.json : raccourci refusé pour {id} (« {binding} ») : syntaxe inconnue, ou touche sans Ctrl ni Alt',
          { id, binding: s.bindings[id] ?? '' },
        ),
      );
    }
    const warnings = new Set([...s.warnings.map((w) => tRust(w)), ...duplicates(next.effective)]);
    for (const w of warnings) {
      if (!shownWarnings.has(w)) toast.error(t('keybindings.json : {warning}', { warning: w }));
    }
    shownWarnings = warnings;
    set({ ...next, readOnly: s.readOnly });
  };

  return {
    ...compute({}),
    readOnly: false,

    init: async () => {
      const unlisten = await Promise.all([
        onKeybindingsChanged(apply),
        onKeybindingsError((e) => {
          toast.error(formatConfigError(e, 'keybindings.json'));
        }),
      ]);
      const snapshot = await keybindingsGet();
      apply(snapshot);
      if (snapshot.error) toast.error(formatConfigError(snapshot.error, 'keybindings.json'));
      return () => {
        unlisten.forEach((off) => {
          off();
        });
      };
    },

    set: async (command, binding) => {
      try {
        await keybindingsSet(command, binding);
        return true;
      } catch (err) {
        toast.error(describe(err));
        return false;
      }
    },

    reset: async (command) => {
      try {
        await keybindingsReset(command);
        return true;
      } catch (err) {
        toast.error(describe(err));
        return false;
      }
    },
  };
});

/** The effective shortcut of a command, or `null` (unbound or unknown). */
export function bindingOf(commandId: string): string | null {
  return useKeybindings.getState().effective[commandId] ?? null;
}
