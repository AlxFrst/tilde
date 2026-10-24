import { FileJson, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { confirmAction } from '@/app/confirm';
import { listCommands, type Command, type CommandGroup } from '@/commands/registry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openKeybindingsFile } from '@/ipc/keybindings';
import { useKeybindings } from '@/stores/keybindings';
import { bindingKeys } from '@/terminal/keyLabels';
import { ShortcutRecorder } from './ShortcutRecorder';

const GROUP_ORDER: CommandGroup[] = [
  'Sessions',
  'Espaces',
  'Panneaux',
  'Terminal',
  'Connexions',
  'Application',
];

function Keys({ binding }: { binding: string | null }) {
  if (!binding) return <span className="text-xs text-text-muted">—</span>;
  return (
    <span className="flex gap-1">
      {bindingKeys(binding).map((k) => (
        <kbd key={k} className="rounded border bg-surface-2 px-1.5 font-mono text-xs">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Every command with its shortcut: record, remove, reset (written to keybindings.json). */
export function ShortcutsSection() {
  const effective = useKeybindings((s) => s.effective);
  const overrides = useKeybindings((s) => s.overrides);
  const readOnly = useKeybindings((s) => s.readOnly);
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const commands = useMemo(() => listCommands(), []);
  const titles = useMemo(() => new Map(commands.map((c) => [c.id, c.title])), [commands]);

  const q = filter.trim().toLowerCase();
  const shown = commands.filter(
    (c) => !q || c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
  );
  const groups = GROUP_ORDER.map(
    (g) => [g, shown.filter((c) => c.group === g)] as [CommandGroup, Command[]],
  ).filter(([, list]) => list.length > 0);

  const conflictOf = useCallback(
    (binding: string) => {
      for (const [id, b] of Object.entries(effective)) {
        if (b === binding && id !== recording) return titles.get(id) ?? id;
      }
      return null;
    },
    [effective, recording, titles],
  );

  const onRecord = useCallback(
    (binding: string) => {
      const id = recording;
      setRecording(null);
      if (!id) return;
      const { set } = useKeybindings.getState();
      void (async () => {
        const holders = Object.entries(useKeybindings.getState().effective)
          .filter(([other, b]) => b === binding && other !== id)
          .map(([other]) => other);
        for (const other of holders) if (!(await set(other, null))) return;
        await set(id, binding);
      })();
    },
    [recording],
  );
  const onCancel = useCallback(() => {
    setRecording(null);
  }, []);

  const resetAll = async () => {
    const ok = await confirmAction({
      title: 'Réinitialiser tous les raccourcis ?',
      description: 'Vos changements dans keybindings.json seront effacés.',
      confirmLabel: 'Réinitialiser',
      destructive: true,
    });
    if (ok) await useKeybindings.getState().reset();
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filtrer les commandes"
          placeholder="Filtrer…"
          className="h-7 w-56"
          value={filter}
          onChange={(e) => {
            setFilter(e.currentTarget.value);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={readOnly || Object.keys(overrides).length === 0}
          onClick={() => void resetAll()}
        >
          <RotateCcw strokeWidth={1.5} />
          Tout réinitialiser
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openKeybindingsFile()}>
          <FileJson strokeWidth={1.5} />
          Ouvrir keybindings.json
        </Button>
      </div>
      {readOnly && (
        <p role="status" className="text-xs text-warning">
          keybindings.json contient une erreur : corrigez-le pour modifier les raccourcis.
        </p>
      )}

      {groups.map(([group, list]) => (
        <section key={group} className="grid gap-1">
          <h3 className="text-xs font-medium tracking-wide text-text-muted uppercase">{group}</h3>
          {list.map((c) => {
            const binding = effective[c.id] ?? null;
            const changed = c.id in overrides;
            return (
              <div
                key={c.id}
                className="flex min-h-9 flex-wrap items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {c.title}
                  {changed && (
                    <span className="ml-2 rounded bg-accent/15 px-1 text-[10px] text-accent">
                      modifié
                    </span>
                  )}
                </span>
                {recording === c.id ? (
                  <ShortcutRecorder
                    label={`Nouveau raccourci pour ${c.title}`}
                    onRecord={onRecord}
                    onCancel={onCancel}
                    conflictOf={conflictOf}
                  />
                ) : (
                  <>
                    <Keys binding={binding} />
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Modifier ${c.title}`}
                      disabled={readOnly}
                      onClick={() => {
                        setRecording(c.id);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Retirer ${c.title}`}
                      disabled={readOnly || binding === null}
                      onClick={() => void useKeybindings.getState().set(c.id, null)}
                    >
                      Retirer
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Réinitialiser ${c.title}`}
                      disabled={readOnly || !changed}
                      onClick={() => void useKeybindings.getState().reset(c.id)}
                    >
                      Réinitialiser
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
