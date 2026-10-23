import { FileCode2, FolderPlus, Plus, Search, ServerCog, Settings2, Terminal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { search, type SearchItem } from '@/connections/search';
import { openConnectionsFile } from '@/ipc/connections';
import { formatConfigError } from '@/ipc/errors';
import type { Appearance } from '@/ipc/generated/settings';
import { isValidTarget } from '@/ipc/ssh';
import { cn } from '@/lib/utils';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { SidebarRow } from './sidebar/ConnectionItem';
import { ConnectionList, ConnectionRow } from './sidebar/ConnectionList';
import { describeTarget } from './sidebar/Section';
import { adoptedAliases } from './sidebar/SshConfigSection';

interface SidebarProps {
  side: Appearance['sidebarPosition'];
  width: number;
  onOpenSettings: () => void;
}

function Results({ query }: { query: string }) {
  const { file, sshHosts } = useConnections();
  const results = useMemo(() => {
    const adopted = adoptedAliases(file.connections);
    const items: SearchItem[] = [
      ...file.connections.map((c) => ({
        key: `conn:${c.id}`,
        label: c.name,
        host: c.host,
        user: c.user,
        tags: c.tags,
        kind: 'connection' as const,
      })),
      ...sshHosts
        .filter((h) => !adopted.has(h.alias))
        .map((h) => ({
          key: `ssh:${h.alias}`,
          label: h.alias,
          host: h.hostname,
          user: h.user,
          tags: [],
          kind: 'sshConfig' as const,
        })),
    ];
    return search(query, items);
  }, [query, file.connections, sshHosts]);
  const byId = new Map(file.connections.map((c) => [c.id, c]));
  const target = query.trim();

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 pt-4">
        <p className="text-text-muted">Aucun résultat</p>
        {isValidTarget(target) && (
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-2"
            onClick={() => {
              useWorkspace.getState().openSshTab(target);
            }}
          >
            <Terminal className="size-4 text-text-muted" strokeWidth={1.5} />
            Se connecter à « {target} »
          </button>
        )}
      </div>
    );
  }
  return (
    <div data-sidebar-list className="grid gap-px px-2 pt-2">
      {results.map((r) => {
        const saved = r.kind === 'connection' ? byId.get(r.key.slice(5)) : undefined;
        if (saved) return <ConnectionRow key={r.key} c={saved} section="search" />;
        return (
          <SidebarRow
            key={r.key}
            Icon={FileCode2}
            title={r.label}
            subtitle={describeTarget({ host: r.host, user: r.user, port: null })}
            onOpen={() => {
              useWorkspace.getState().openSshTab(r.label);
            }}
          />
        );
      })}
    </div>
  );
}

export function Sidebar({ side, width, onOpenSettings }: SidebarProps) {
  const { readOnly, error, setEditing, setEditingFolder } = useConnections();
  const [query, setQuery] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);

  return (
    <aside
      aria-label="Connexions"
      data-side={side}
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col bg-surface-1',
        side === 'left' ? 'border-r' : 'border-l',
      )}
      onKeyDown={(e) => {
        // Ctrl+F (⌘F) while the sidebar has the focus: search.
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyF') {
          e.preventDefault();
          searchBox.current?.focus();
        }
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-xs font-medium tracking-wide text-text-muted uppercase">
          Connexions
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Ajouter"
              title="Nouvelle connexion ou dossier"
              disabled={readOnly}
              className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              onSelect={() => {
                setEditing(blankConnection());
              }}
            >
              <ServerCog strokeWidth={1.5} /> Nouvelle connexion…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setEditingFolder('new');
              }}
            >
              <FolderPlus strokeWidth={1.5} /> Nouveau dossier…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative px-3 pb-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-text-muted"
          strokeWidth={1.5}
        />
        <input
          ref={searchBox}
          type="search"
          aria-label="Rechercher une connexion"
          placeholder="Rechercher…"
          spellCheck={false}
          value={query}
          className="h-7 w-full rounded-md border bg-background pr-2 pl-7 text-sm outline-none placeholder:text-text-muted focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              e.currentTarget
                .closest('aside')
                ?.querySelector<HTMLElement>('[data-sidebar-row]')
                ?.focus();
            }
          }}
        />
      </div>

      {readOnly && error && (
        <div
          role="alert"
          className="mx-3 my-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <p>{formatConfigError(error, 'connections.json')}</p>
          <button
            type="button"
            className="mt-1 underline"
            onClick={() => void openConnectionsFile()}
          >
            Ouvrir le fichier
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.trim() ? <Results query={query} /> : <ConnectionList />}
      </div>

      <div className="border-t p-2">
        <button
          type="button"
          aria-label="Réglages"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Settings2 className="size-4" strokeWidth={1.5} />
          <span>Réglages</span>
        </button>
      </div>
    </aside>
  );
}
