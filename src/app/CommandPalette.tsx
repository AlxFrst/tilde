import { Command } from 'cmdk';
import { FileCode2, History, Search } from 'lucide-react';
import { useMemo } from 'react';
import { listCommands, runCommand, type Command as AppCommand } from '@/commands/registry';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { connectionIcon } from '@/connections/icons';
import type { Connection } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys } from '@/terminal/keyLabels';
import { activeTerminal } from '@/terminal/terminalActions';
import { openConnection } from './actions';
import { describeTarget } from './sidebar/Section';
import { adoptedAliases } from './sidebar/SshConfigSection';

interface Target {
  key: string;
  label: string;
  detail: string;
  keywords: string[];
  open: () => void;
  connection?: Connection;
  kind: 'connection' | 'sshConfig' | 'recent';
}

/** Recents first, then saved connections, then ~/.ssh/config hosts; each once. */
function useTargets(): Target[] {
  const { file, sshHosts } = useConnections();
  return useMemo(() => {
    const byId = new Map(file.connections.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: Target[] = [];
    const fromConnection = (c: Connection): Target => ({
      key: `conn:${c.id}`,
      label: c.name,
      detail: describeTarget(c),
      keywords: [c.host, c.user ?? '', ...c.tags],
      open: () => {
        openConnection(c);
      },
      connection: c,
      kind: 'connection',
    });
    const push = (t: Target) => {
      if (seen.has(t.key)) return;
      seen.add(t.key);
      out.push(t);
    };
    for (const r of file.recents) {
      const saved = r.key.startsWith('conn:') ? byId.get(r.key.slice(5)) : undefined;
      if (saved) push(fromConnection(saved));
      else if (r.key.startsWith('ssh:')) {
        const target = r.key.slice(4);
        push({
          key: r.key,
          label: target,
          detail: 'récent',
          keywords: [],
          open: () => {
            useWorkspace.getState().openSshTab(target);
          },
          kind: 'recent',
        });
      }
    }
    for (const c of file.connections) push(fromConnection(c));
    const adopted = adoptedAliases(file.connections);
    for (const h of sshHosts) {
      if (adopted.has(h.alias)) continue;
      push({
        key: `ssh:${h.alias}`,
        label: h.alias,
        detail: describeTarget({ host: h.hostname, user: h.user, port: h.port }),
        keywords: [h.hostname, h.user],
        open: () => {
          useWorkspace.getState().openSshTab(h.alias);
        },
        kind: 'sshConfig',
      });
    }
    return out;
  }, [file, sshHosts]);
}

function Shortcut({ command }: { command: AppCommand }) {
  if (!command.keybinding) return null;
  return (
    <span className="ml-auto flex gap-1">
      {bindingKeys(command.keybinding).map((k) => (
        <kbd
          key={k}
          className="rounded border bg-surface-2 px-1 font-mono text-[10px] text-text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

const itemClass =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-surface-2';

/** Ctrl+Shift+P: connections first, then every command of the registry. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const targets = useTargets();
  // Read when the palette opens: commands registered later still show next time.
  const commands = useMemo(() => (open ? listCommands().filter((c) => !c.hidden) : []), [open]);

  const close = () => {
    setOpen(false);
    activeTerminal()?.focus();
  };
  const choose = (run: () => void) => {
    close();
    run();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Palette de commandes</DialogTitle>
        <Command label="Palette de commandes" loop>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-text-muted" strokeWidth={1.5} />
            <Command.Input
              autoFocus
              placeholder="Se connecter à… ou lancer une commande"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
            />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-text-muted">
              Aucun résultat
            </Command.Empty>
            {targets.length > 0 && (
              <Command.Group
                heading="Connexions"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-muted"
              >
                {targets.map((t) => {
                  const Icon =
                    t.kind === 'connection'
                      ? connectionIcon(t.connection?.icon)
                      : t.kind === 'recent'
                        ? History
                        : FileCode2;
                  return (
                    <Command.Item
                      key={t.key}
                      value={`${t.label} ${t.key}`}
                      keywords={t.keywords}
                      className={itemClass}
                      onSelect={() => {
                        choose(t.open);
                      }}
                    >
                      <Icon
                        className="size-4 shrink-0"
                        strokeWidth={1.5}
                        style={{ color: t.connection?.color ?? undefined }}
                      />
                      <span className="truncate">{t.label}</span>
                      <span className="ml-auto truncate text-xs text-text-muted">{t.detail}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
            <Command.Group
              heading="Commandes"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-muted"
            >
              {commands.map((c) => (
                <Command.Item
                  key={c.id}
                  value={`${c.title} ${c.id}`}
                  keywords={[c.group]}
                  className={itemClass}
                  onSelect={() => {
                    choose(() => {
                      runCommand(c.id);
                    });
                  }}
                >
                  <span className="truncate">{c.title}</span>
                  <Shortcut command={c} />
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
