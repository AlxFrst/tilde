import { Keyboard } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUi } from '@/stores/ui';
import { bindingKeys } from '@/terminal/keyLabels';
import { eventToBinding, parseBinding, requiresModifier, type Binding } from '@/terminal/keys';

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Ctrl+letter is a shell control key (Ctrl+C interrupts, Ctrl+W deletes a word…). */
function isShellKey(b: Binding): boolean {
  return !isMac() && b.ctrl && !b.alt && !b.shift && /^[A-Z]$/.test(b.key);
}

interface Pending {
  binding: string;
  message: string;
  confirm: string;
  /** `shell`: confirming goes on to the conflict check. */
  stage: 'shell' | 'conflict';
}

/**
 * Records the next key combination. App shortcuts are paused meanwhile, and the keys
 * never reach the terminal. `conflictOf` names the command already using a binding;
 * `validate` refuses bindings a caller cannot use (with the reason).
 */
export function ShortcutRecorder({
  label,
  onRecord,
  onCancel,
  conflictOf,
  validate,
}: {
  label: string;
  onRecord: (binding: string) => void;
  onCancel: () => void;
  conflictOf?: (binding: string) => string | null;
  validate?: (b: Binding) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    useUi.setState({ recordingShortcut: true });
    return () => {
      useUi.setState({ recordingShortcut: false });
    };
  }, []);

  const afterShellCheck = useCallback(
    (binding: string) => {
      const title = conflictOf?.(binding) ?? null;
      if (title) {
        setPending({
          binding,
          message: `Déjà utilisé par « ${title} »`,
          confirm: 'Remplacer',
          stage: 'conflict',
        });
      } else onRecord(binding);
    },
    [conflictOf, onRecord],
  );

  useEffect(() => {
    // While asking for a confirmation, keys go to the buttons.
    if (pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onCancel();
        return;
      }
      const binding = eventToBinding(e);
      const parsed = binding ? parseBinding(binding) : null;
      if (!binding || !parsed) return;
      if (requiresModifier(parsed) && !parsed.ctrl && !parsed.alt) {
        setError('Ajoutez Ctrl ou Alt : une touche seule casserait la saisie dans le terminal.');
        return;
      }
      const refused = validate?.(parsed) ?? null;
      if (refused) {
        setError(refused);
        return;
      }
      if (isShellKey(parsed)) {
        setPending({
          binding,
          message: 'Utilisé par le shell (interrompre, effacer un mot, rechercher…)',
          confirm: 'Utiliser quand même',
          stage: 'shell',
        });
        return;
      }
      afterShellCheck(binding);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [pending, validate, onCancel, afterShellCheck]);

  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
        <span>
          {bindingKeys(pending.binding).join(' + ')} — {pending.message}
        </span>
        <Button
          size="xs"
          onClick={() => {
            const { binding, stage } = pending;
            setPending(null);
            if (stage === 'shell') afterShellCheck(binding);
            else onRecord(binding);
          }}
        >
          {pending.confirm}
        </Button>
        <Button size="xs" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className="flex flex-wrap items-center gap-2 rounded-md border border-primary/60 px-2 py-1.5 text-xs"
    >
      <Keyboard className="size-3.5 text-primary" strokeWidth={1.5} />
      <span>Appuyez sur la combinaison… (Échap pour annuler)</span>
      {error && (
        <span role="alert" className="text-warning">
          {error}
        </span>
      )}
    </div>
  );
}
