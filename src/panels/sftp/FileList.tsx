import { File, FileSymlink, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { RemoteEntry } from '@/ipc/sftp';
import { cn } from '@/lib/utils';
import { formatDate, formatMode, formatSize } from './format';

export type SortKey = 'name' | 'size' | 'modified';
export interface Sort {
  key: SortKey;
  asc: boolean;
}

/** Folders first, then by the chosen column. */
export function sortEntries(entries: RemoteEntry[], sort: Sort): RemoteEntry[] {
  const dir = sort.asc ? 1 : -1;
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === 'dir') - Number(a.kind === 'dir');
    if (folders !== 0) return folders;
    if (sort.key === 'size') return (a.size - b.size) * dir;
    if (sort.key === 'modified') return ((a.modified ?? 0) - (b.modified ?? 0)) * dir;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) * dir;
  });
}

const ICON = { dir: Folder, symlink: FileSymlink, file: File, other: File };

/** Moves the focus to the previous or next row. */
function focusRow(from: HTMLElement, delta: 1 | -1): void {
  const rows = Array.from(
    from.closest('[role="grid"]')?.querySelectorAll<HTMLElement>('[role="row"][data-path]') ?? [],
  );
  rows[rows.indexOf(from) + delta]?.focus();
}

export function FileList({
  entries,
  sort,
  onSort,
  selected,
  onSelect,
  onOpen,
  onUp,
  onDelete,
  onRename,
  menu,
}: {
  entries: RemoteEntry[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  selected: Set<string>;
  onSelect: (e: RemoteEntry, how: 'single' | 'toggle' | 'range') => void;
  onOpen: (e: RemoteEntry) => void;
  onUp: () => void;
  onDelete: (e: RemoteEntry) => void;
  onRename: (e: RemoteEntry) => void;
  menu: (e: RemoteEntry) => ReactNode;
}) {
  const header = (key: SortKey, label: string, className?: string) => (
    <button
      type="button"
      role="columnheader"
      aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}
      className={cn('truncate px-2 py-1 text-left hover:text-text', className)}
      onClick={() => {
        onSort(key);
      }}
    >
      {label}
      {sort.key === key && (sort.asc ? ' ↑' : ' ↓')}
    </button>
  );
  return (
    <div role="grid" aria-label="Fichiers" className="flex min-h-0 flex-1 flex-col text-sm">
      <div
        role="row"
        className="grid grid-cols-[1fr_6rem_9rem_7rem] border-b text-xs text-text-muted"
      >
        {header('name', 'Nom')}
        {header('size', 'Taille', 'text-right')}
        {header('modified', 'Modifié')}
        <span role="columnheader" className="px-2 py-1">
          Droits
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="px-3 py-6 text-center text-text-muted">Dossier vide</p>
        )}
        {entries.map((e) => {
          const Icon = ICON[e.kind];
          return (
            <ContextMenu key={e.path}>
              <ContextMenuTrigger asChild>
                <div
                  role="row"
                  tabIndex={0}
                  data-path={e.path}
                  aria-selected={selected.has(e.path)}
                  className={cn(
                    'grid cursor-default grid-cols-[1fr_6rem_9rem_7rem] items-center outline-none select-none',
                    'hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-ring',
                    selected.has(e.path) && 'bg-surface-2',
                  )}
                  onClick={(ev) => {
                    onSelect(
                      e,
                      ev.shiftKey ? 'range' : ev.ctrlKey || ev.metaKey ? 'toggle' : 'single',
                    );
                  }}
                  onContextMenu={() => {
                    if (!selected.has(e.path)) onSelect(e, 'single');
                  }}
                  onDoubleClick={() => {
                    onOpen(e);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') onOpen(e);
                    else if (ev.key === 'Backspace') onUp();
                    else if (ev.key === 'Delete') onDelete(e);
                    else if (ev.key === 'F2') onRename(e);
                    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                      focusRow(ev.currentTarget, ev.key === 'ArrowDown' ? 1 : -1);
                    } else return;
                    ev.preventDefault();
                  }}
                  onFocus={() => {
                    if (!selected.has(e.path)) onSelect(e, 'single');
                  }}
                >
                  <span role="gridcell" className="flex min-w-0 items-center gap-2 px-2 py-1">
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        e.kind === 'dir' ? 'text-primary' : 'text-text-muted',
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <span role="gridcell" className="px-2 text-right text-text-muted tabular-nums">
                    {e.kind === 'dir' ? '' : formatSize(e.size)}
                  </span>
                  <span role="gridcell" className="truncate px-2 text-text-muted tabular-nums">
                    {formatDate(e.modified)}
                  </span>
                  <span role="gridcell" className="px-2 font-mono text-xs text-text-muted">
                    {formatMode(e.permissions, e.kind)}
                  </span>
                </div>
              </ContextMenuTrigger>
              {menu(e)}
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
