import { FileCode2, Plus } from 'lucide-react';
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import type { Connection } from '@/ipc/connections';
import type { SshHostEntry } from '@/ipc/ssh';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { Section, describeTarget } from './Section';
import { SidebarRow } from './ConnectionItem';

/** Aliases already saved as-is (a connection on that host without overrides). */
export function adoptedAliases(connections: Connection[]): Set<string> {
  return new Set(
    connections
      .filter(
        (c) =>
          c.user === null &&
          c.port === null &&
          c.identityFile === null &&
          c.proxyJump === null &&
          c.forwardAgent === null,
      )
      .map((c) => c.host),
  );
}

/** Hosts of ~/.ssh/config, read-only: open them, or adopt them as saved connections. */
export function SshConfigSection({ hosts }: { hosts: SshHostEntry[] }) {
  const readOnly = useConnections((s) => s.readOnly);
  const adopt = useConnections((s) => s.adopt);
  const open = (alias: string) => {
    useWorkspace.getState().openSshTab(alias);
  };
  return (
    <Section title="~/.ssh/config">
      {hosts.map((h) => (
        <SidebarRow
          key={h.alias}
          Icon={FileCode2}
          title={h.alias}
          subtitle={describeTarget({ host: h.hostname, user: h.user, port: h.port })}
          onOpen={() => {
            open(h.alias);
          }}
          menu={
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  open(h.alias);
                }}
              >
                Ouvrir
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => {
                  void adopt(h.alias);
                }}
              >
                Adopter (enregistrer dans Tilde)
              </ContextMenuItem>
            </ContextMenuContent>
          }
          action={
            readOnly ? undefined : (
              <button
                type="button"
                aria-label={`Adopter ${h.alias}`}
                title="Adopter : enregistrer dans Tilde (dossier, couleur, tags…)"
                className="rounded p-1 text-text-muted hover:bg-surface-1 hover:text-text"
                onClick={() => void adopt(h.alias)}
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
              </button>
            )
          }
        />
      ))}
    </Section>
  );
}
