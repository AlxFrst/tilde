import { Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProfiles } from '@/stores/profiles';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys, resolveKeyLabels } from '@/terminal/keyLabels';
import type { CommandId } from '@/terminal/keys';
import { Logo } from './Logo';
import { profileIcon } from './profileIcon';

const SHORTCUTS: [CommandId, string][] = [
  ['tab.new', 'Nouvel onglet'],
  ['ssh.quickConnect', 'Connexion SSH'],
  ['pane.splitRight', 'Diviser à droite'],
  ['pane.splitDown', 'Diviser en bas'],
  ['pane.focusLeft', 'Changer de panneau'],
  ['terminal.search', 'Rechercher'],
];

/** Keycaps shown for each shortcut; focus moves list all four arrows. */
function useShortcutKeys() {
  const [labels, setLabels] = useState<Partial<Record<CommandId, string[]>>>(() =>
    Object.fromEntries(SHORTCUTS.map(([id]) => [id, bindingKeys(id)])),
  );
  useEffect(() => {
    let cancelled = false;
    void resolveKeyLabels(SHORTCUTS.map(([id]) => id)).then((l) => {
      if (!cancelled) setLabels(l);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (id: CommandId) => (id === 'pane.focusLeft' ? ['Alt', '←↑→↓'] : (labels[id] ?? []));
}

/** Shown when no tab is open. */
export function Welcome({ version }: { version: string }) {
  const profiles = useProfiles((s) => s.profiles);
  const loaded = useProfiles((s) => s.loaded);
  const keysFor = useShortcutKeys();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <Logo className="size-20" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tilde</h1>
        <p className="mt-1 text-text-muted">v{version}</p>
      </div>
      <div className="flex max-w-xl flex-wrap justify-center gap-2">
        {profiles.map((p) => {
          const Icon = profileIcon(p.icon);
          return (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              onClick={() => {
                useWorkspace.getState().openTab(p.id);
              }}
            >
              <Icon strokeWidth={1.5} style={p.color ? { color: p.color } : undefined} />
              {p.name}
            </Button>
          );
        })}
        {loaded && profiles.length === 0 && <p className="text-text-muted">Aucun shell détecté</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            useSsh.getState().setQuickConnectOpen(true);
          }}
        >
          <Server strokeWidth={1.5} />
          Connexion SSH
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-text-muted">
        {SHORTCUTS.map(([id, label]) => (
          <div key={label} className="contents">
            <dt className="flex justify-end gap-1">
              {keysFor(id).map((k) => (
                <kbd
                  key={k}
                  className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text"
                >
                  {k}
                </kbd>
              ))}
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
