import { FileDown, FileUp, Pencil, Search, ServerCog, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { connectionIcon } from '@/connections/icons';
import { search, type SearchItem } from '@/connections/search';
import { connectionSpace, listSpaces, spaceName } from '@/connections/spaces';
import { exportWithToast, importWithReport } from '@/connections/transfer';
import { t } from '@/i18n';
import type { Connection } from '@/ipc/connections';
import { blankConnection, useConnections } from '@/stores/connections';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { openConnection } from '../actions';
import { describeTarget } from '../sidebar/Section';
import { adoptedAliases, SshConfigSection } from '../sidebar/SshConfigSection';
import { RowAction } from './RowAction';

function ConnectionLine({ c, here, Icon }: { c: Connection; here: boolean; Icon: LucideIcon }) {
  const { file, readOnly, save, setEditing } = useConnections();
  const active = useWorkspace((s) => s.activeSpaceId);
  const folder = c.folderId ? file.folders.find((f) => f.id === c.folderId) : undefined;
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-1">
      <Icon
        className="size-4 shrink-0"
        strokeWidth={1.6}
        style={{ color: c.color ?? 'var(--tilde-text-muted)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{c.name}</span>
        <span className="block truncate text-xs text-text-muted">
          {describeTarget(c)}
          {folder ? ` · ${folder.name}` : ''}
        </span>
      </span>
      <RowAction
        label={t('Ouvrir {name}', { name: c.name })}
        onClick={() => {
          useUi.getState().setLibraryOpen(false);
          openConnection(c);
        }}
      >
        {t('Ouvrir')}
      </RowAction>
      {!here && (
        <RowAction
          label={t('Ouvrir {name} ici', { name: c.name })}
          onClick={() => {
            useUi.getState().setLibraryOpen(false);
            useWorkspace.getState().openSshTab(c.host, c.id);
          }}
        >
          {t('Ouvrir ici')}
        </RowAction>
      )}
      {!here && (
        <RowAction
          label={t('Déplacer {name} ici', { name: c.name })}
          disabled={readOnly}
          onClick={() => {
            void save({ ...c, spaceId: active });
          }}
        >
          {t('Déplacer ici')}
        </RowAction>
      )}
      <button
        type="button"
        aria-label={t('Modifier {name}', { name: c.name })}
        disabled={readOnly}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
        onClick={() => {
          setEditing(c);
        }}
      >
        <Pencil className="size-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );
}

function LibraryBody() {
  const { file, sshHosts, readOnly, setEditing } = useConnections();
  const active = useWorkspace((s) => s.activeSpaceId);
  const [query, setQuery] = useState('');
  const [hostsOpen, setHostsOpen] = useState(true);
  const spaces = listSpaces(file);
  const adopted = adoptedAliases(file.connections);
  const freeHosts = sshHosts.filter((h) => !adopted.has(h.alias));

  const matches = useMemo(() => {
    const items: (SearchItem & { id: string })[] = [
      ...file.connections.map((c) => ({
        id: c.id,
        key: `conn:${c.id}`,
        label: c.name,
        host: c.host,
        user: c.user,
        tags: c.tags,
        kind: 'connection' as const,
      })),
      ...freeHosts.map((h) => ({
        id: h.alias,
        key: `ssh:${h.alias}`,
        label: h.alias,
        host: h.hostname,
        user: h.user,
        tags: [],
        kind: 'sshConfig' as const,
      })),
    ];
    return new Set(search(query, items).map((i) => i.key));
  }, [query, file.connections, freeHosts]);

  const connections = file.connections.filter((c) => matches.has(`conn:${c.id}`));
  const hosts = freeHosts.filter((h) => matches.has(`ssh:${h.alias}`));
  // The space shown first: its connections are the ones the user expects.
  const ordered = [
    ...spaces.filter((s) => s.id === active),
    ...spaces.filter((s) => s.id !== active),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted"
          strokeWidth={1.75}
        />
        <input
          type="search"
          autoFocus
          aria-label={t('Rechercher dans la Bibliothèque')}
          placeholder={t('Nom, hôte, utilisateur, tag…')}
          spellCheck={false}
          value={query}
          className="h-9 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none placeholder:text-text-muted focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
        {ordered.map((space) => {
          const mine = connections.filter((c) => connectionSpace(c, file) === space.id);
          if (mine.length === 0) return null;
          const Icon = connectionIcon(space.icon);
          const name = spaceName(space);
          return (
            <section key={space.id} role="group" aria-label={name} className="mb-3">
              <h3 className="flex items-center gap-2 px-2 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
                <Icon
                  className="size-3.5"
                  strokeWidth={1.6}
                  style={{ color: space.color ?? undefined }}
                />
                <span className="normal-case">{name}</span>
                {space.id === active && (
                  <span className="normal-case">· {t('espace affiché')}</span>
                )}
              </h3>
              <ul className="grid gap-px">
                {mine.map((c) => (
                  <ConnectionLine
                    key={c.id}
                    c={c}
                    here={space.id === active}
                    Icon={connectionIcon(c.icon)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {connections.length === 0 && query.trim() === '' && (
          <p className="px-2 pb-3 text-sm text-text-muted">{t('Aucune connexion enregistrée.')}</p>
        )}
        {hosts.length > 0 && (
          <div data-sidebar-list>
            <SshConfigSection hosts={hosts} open={hostsOpen} onOpenChange={setHostsOpen} />
          </div>
        )}
        {connections.length === 0 && hosts.length === 0 && query.trim() !== '' && (
          <p className="px-2 text-sm text-text-muted">{t('Aucun résultat.')}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          disabled={readOnly}
          onClick={() => {
            setEditing(blankConnection({ spaceId: file.spaces.length > 0 ? active : null }));
          }}
        >
          <ServerCog strokeWidth={1.5} /> {t('Nouvelle connexion')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void importWithReport()}>
          <FileDown strokeWidth={1.5} /> {t('Importer…')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void exportWithToast()}>
          <FileUp strokeWidth={1.5} /> {t('Exporter…')}
        </Button>
      </div>
    </div>
  );
}

/** Every saved connection of every space, and the ~/.ssh/config hosts. */
export function LibraryDialog() {
  const open = useUi((s) => s.libraryOpen);
  return (
    <Dialog open={open} onOpenChange={useUi.getState().setLibraryOpen}>
      <DialogContent className="flex h-[80vh] max-h-[760px] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('Bibliothèque')}</DialogTitle>
          <DialogDescription>
            {t('Toutes vos connexions, de tous les espaces, et les hôtes de ~/.ssh/config.')}
          </DialogDescription>
        </DialogHeader>
        {open && <LibraryBody />}
      </DialogContent>
    </Dialog>
  );
}
