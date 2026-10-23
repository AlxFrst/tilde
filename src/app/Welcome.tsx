import { Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProfiles } from '@/stores/profiles';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { useKeybindings } from '@/stores/keybindings';
import { bindingKeys, resolveKeyLabels } from '@/terminal/keyLabels';
import { Logo } from './Logo';
import { profileIcon } from './profileIcon';

const SHORTCUTS: [string, string][] = [
  ['tab.new', 'Nouvel onglet'],
  ['ssh.quickConnect', 'Connexion SSH'],
  ['palette.toggle', 'Palette de commandes'],
  ['pane.splitRight', 'Diviser à droite'],
  ['pane.splitDown', 'Diviser en bas'],
  ['pane.focusLeft', 'Changer de panneau'],
  ['terminal.search', 'Rechercher'],
];

/** Keycaps shown for each shortcut (none when unbound), labelled for the keyboard layout. */
function useShortcutKeys() {
  const effective = useKeybindings((s) => s.effective);
  const [labels, setLabels] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    const bindings = SHORTCUTS.map(([id]) => effective[id]).filter((b) => b != null);
    void resolveKeyLabels(bindings).then((l) => {
      if (!cancelled) setLabels(l);
    });
    return () => {
      cancelled = true;
    };
  }, [effective]);
  return (id: string) => {
    const binding = effective[id];
    if (!binding) return [];
    // The four focus moves share a modifier; show them as one line when unchanged.
    if (id === 'pane.focusLeft' && binding === 'Alt+ArrowLeft') return ['Alt', '←↑→↓'];
    return labels[binding] ?? bindingKeys(binding);
  };
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
        {SHORTCUTS.filter(([id]) => keysFor(id).length > 0).map(([id, label]) => (
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
