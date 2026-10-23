import { Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUi } from '@/stores/ui';
import { bindingKeys } from '@/terminal/keyLabels';
import { eventToBinding, parseBinding, requiresModifier } from '@/terminal/keys';

/**
 * Records the next key combination. App shortcuts are paused meanwhile, and the keys
 * never reach the terminal. `conflictOf` names the command already using a binding.
 */
export function ShortcutRecorder({
  label,
  onRecord,
  onCancel,
  conflictOf,
}: {
  label: string;
  onRecord: (binding: string) => void;
  onCancel: () => void;
  conflictOf?: (binding: string) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ binding: string; title: string } | null>(null);

  useEffect(() => {
    useUi.setState({ recordingShortcut: true });
    return () => {
      useUi.setState({ recordingShortcut: false });
    };
  }, []);

  useEffect(() => {
    // While asking about a conflict, keys go to the buttons.
    if (conflict) return;
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
      const title = conflictOf?.(binding) ?? null;
      if (title) setConflict({ binding, title });
      else onRecord(binding);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [conflict, conflictOf, onCancel, onRecord]);

  if (conflict) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
        <span>
          {bindingKeys(conflict.binding).join(' + ')} — Déjà utilisé par « {conflict.title} »
        </span>
        <Button
          size="xs"
          onClick={() => {
            onRecord(conflict.binding);
          }}
        >
          Remplacer
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
      className="flex flex-wrap items-center gap-2 rounded-md border border-accent/60 px-2 py-1.5 text-xs"
    >
      <Keyboard className="size-3.5 text-accent" strokeWidth={1.5} />
      <span>Appuyez sur la combinaison… (Échap pour annuler)</span>
      {error && (
        <span role="alert" className="text-warning">
          {error}
        </span>
      )}
    </div>
  );
}
