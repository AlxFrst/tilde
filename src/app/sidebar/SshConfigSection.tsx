import { ChevronRight, FileCode2 } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Connection } from '@/ipc/connections';
import type { SshHostEntry } from '@/ipc/ssh';
import { useConnections } from '@/stores/connections';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { Section, describeTarget } from './Section';
import { RowAction } from '../library/RowAction';

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

/** Hosts of ~/.ssh/config in the Library, read-only: open, adopt or tuck them away. */
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
          {t('Masqués ({count})', { count: away.length })}
        </button>
      )}
      {showHidden &&
        away.map((h) => (
          <HostRow
            key={h.alias}
            h={h}
            muted
            onTuck={() => {
              setHidden(hidden.filter((a) => a !== h.alias));
            }}
          />
        ))}
    </Section>
  );
}

const NO_HOSTS: string[] = [];

/** A host as a Library line: every action is a visible button. */
function HostRow({
  h,
  muted,
  onTuck,
}: {
  h: SshHostEntry;
  /** A hidden host: its button brings it back. */
  muted?: boolean;
  onTuck: () => void;
}) {
  const readOnly = useConnections((s) => s.readOnly);
  const adoptIn = useConnections((s) => s.adopt);
  // Adopted in the space shown (none written while there is only the implicit one).
  const space = useWorkspace((s) => s.activeSpaceId);
  const written = useConnections((s) => s.file.spaces.length > 0);
  const open = () => {
    useUi.getState().setLibraryOpen(false);
    useWorkspace.getState().openSshTab(h.alias);
  };
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-1',
        muted && 'opacity-60 hover:opacity-100',
      )}
    >
      <FileCode2 className="size-4 shrink-0 text-text-muted" strokeWidth={1.6} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{h.alias}</span>
        <span className="block truncate text-xs text-text-muted">
          {describeTarget({ host: h.hostname, user: h.user, port: h.port })}
        </span>
      </span>
      <RowAction label={t('Ouvrir {name}', { name: h.alias })} onClick={open}>
        {t('Ouvrir')}
      </RowAction>
      <RowAction
        label={t('Adopter {name}', { name: h.alias })}
        title={t('Enregistrer dans Tilde (espace, dossier, couleur, tags…)')}
        disabled={readOnly}
        onClick={() => void adoptIn(h.alias, written ? space : null)}
      >
        {t('Adopter')}
      </RowAction>
      <RowAction
        label={
          muted
            ? t('Ne plus masquer {name}', { name: h.alias })
            : t('Masquer {name}', { name: h.alias })
        }
        onClick={onTuck}
      >
        {muted ? t('Ne plus masquer') : t('Masquer')}
      </RowAction>
    </div>
  );
}
