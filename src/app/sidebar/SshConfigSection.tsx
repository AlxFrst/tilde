import { ChevronRight, FileCode2, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { Connection } from '@/ipc/connections';
import type { SshHostEntry } from '@/ipc/ssh';
import { useConnections } from '@/stores/connections';
import { useSettings } from '@/stores/settings';
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

/** Above this many hosts, the section starts folded. */
const FOLD_ABOVE = 8;

/** Hosts of ~/.ssh/config, read-only: open them, adopt them, or tuck them away. */
export function SshConfigSection({
  hosts,
  open: storedOpen,
  onOpenChange,
}: {
  hosts: SshHostEntry[];
  /** `null` until the user folds or unfolds it. */
  open: boolean | null;
  onOpenChange: (open: boolean) => void;
}) {
  const hidden = useSettings((s) => s.settings?.appearance.sshConfigHosts.hidden) ?? NO_HOSTS;
  const [showHidden, setShowHidden] = useState(false);
  const open = storedOpen ?? hosts.length <= FOLD_ABOVE;
  const tucked = new Set(hidden);
  const shown = hosts.filter((h) => !tucked.has(h.alias));
  const away = hosts.filter((h) => tucked.has(h.alias));
  const setHidden = (next: string[]) => {
    void useSettings.getState().update({ appearance: { sshConfigHosts: { hidden: next } } });
  };
  return (
    <Section
      title="~/.ssh/config"
      count={hosts.length}
      collapsed={!open}
      onToggle={() => {
        onOpenChange(!open);
      }}
    >
      {shown.map((h) => (
        <HostRow
          key={h.alias}
          h={h}
          tuckLabel="Masquer"
          onTuck={() => {
            setHidden([...hidden, h.alias]);
          }}
        />
      ))}
      {away.length > 0 && (
        <button
          type="button"
          aria-expanded={showHidden}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-2 hover:text-text"
          onClick={() => {
            setShowHidden(!showHidden);
          }}
        >
          <ChevronRight
            className={cn('size-3 transition-transform', showHidden && 'rotate-90')}
            strokeWidth={1.5}
          />
          {`Masqués (${String(away.length)})`}
        </button>
      )}
      {showHidden &&
        away.map((h) => (
          <HostRow
            key={h.alias}
            h={h}
            muted
            tuckLabel="Ne plus masquer"
            onTuck={() => {
              setHidden(hidden.filter((a) => a !== h.alias));
            }}
          />
        ))}
    </Section>
  );
}

const NO_HOSTS: string[] = [];

function HostRow({
  h,
  muted,
  tuckLabel,
  onTuck,
}: {
  h: SshHostEntry;
  muted?: boolean;
  tuckLabel: string;
  onTuck: () => void;
}) {
  const readOnly = useConnections((s) => s.readOnly);
  const adopt = useConnections((s) => s.adopt);
  const open = () => {
    useWorkspace.getState().openSshTab(h.alias);
  };
  return (
    <div className={cn(muted && 'opacity-60 hover:opacity-100')}>
      <SidebarRow
        Icon={FileCode2}
        title={h.alias}
        subtitle={describeTarget({ host: h.hostname, user: h.user, port: h.port })}
        onOpen={open}
        menu={
          <ContextMenuContent>
            <ContextMenuItem onSelect={open}>Ouvrir</ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => {
                void adopt(h.alias);
              }}
            >
              Adopter (enregistrer dans Tilde)
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onTuck}>{tuckLabel}</ContextMenuItem>
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
    </div>
  );
}
