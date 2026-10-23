import { toast } from 'sonner';
import { create } from 'zustand';
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
    if (parsed) effective[id] = formatBinding(parsed);
    else invalid.push(id);
  }
  return { overrides, effective, invalid, table: compileBindings(effective) };
}

function describe(err: unknown): string {
  if (isConfigError(err)) return formatConfigError(err, 'keybindings.json');
  return typeof err === 'string' ? err : 'Erreur inattendue';
}

export const useKeybindings = create<KeybindingsState>()((set, get) => {
  let shownWarnings = new Set<string>();

  const apply = (s: KeybindingsSnapshot) => {
    const next = compute(s.bindings);
    const before = new Set(get().invalid.map((id) => `${id}=${get().overrides[id] ?? ''}`));
    for (const id of next.invalid) {
      if (before.has(`${id}=${s.bindings[id] ?? ''}`)) continue;
      toast.error(`keybindings.json : raccourci invalide pour ${id} (« ${s.bindings[id] ?? ''} »)`);
    }
    const warnings = new Set(s.warnings);
    for (const w of warnings) if (!shownWarnings.has(w)) toast.error(`keybindings.json : ${w}`);
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
