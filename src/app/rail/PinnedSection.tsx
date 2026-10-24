import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { FileDown, FileUp, FolderPlus, Library, Plus, ServerCog } from 'lucide-react';
import { useState } from 'react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { connectionIcon } from '@/connections/icons';
import { connectionSpace, listSpaces, spaceIdOf } from '@/connections/spaces';
import { exportWithToast, importWithReport } from '@/connections/transfer';
import type { Connection, Folder } from '@/ipc/connections';
import { cn } from '@/lib/utils';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { leaves } from '@/workspace/tree';
import { closeTab, openConnection } from '../actions';
import { StatusDot } from '../ConnectionStatus';
import { confirmAction } from '../confirm';
import { Section, describeTarget } from '../sidebar/Section';
import { ConnectionMenu } from './ConnectionMenu';
import { PaneList } from './PaneList';
import { RowShell } from './SessionRow';
import { useSessionStatus } from './sessionStatus';

const COLLAPSED_KEY = 'tilde.sidebar.collapsedFolders';

function loadCollapsed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: folders simply start expanded next time.
  }
}

function FolderMenu({ f }: { f: Folder }) {
  const { readOnly, removeFolder, setEditingFolder, setEditing } = useConnections();
  return (
    <ContextMenuContent className="min-w-48">
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          setEditing(blankConnection({ folderId: f.id, spaceId: f.spaceId }));
        }}
      >
        Nouvelle connexion ici…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          setEditingFolder(f);
        }}
      >
        Renommer…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={readOnly}
        onSelect={() => {
          void confirmAction({
            title: `Supprimer le dossier « ${f.name} » ?`,
            description: 'Ses connexions sont conservées et passent hors dossier.',
            confirmLabel: 'Supprimer',
            destructive: true,
          }).then((ok) => (ok ? removeFolder(f.id) : undefined));
        }}
      >
        Supprimer le dossier
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** A saved connection: asleep until its pinned session opens, then live. */
function PinnedRow({ c }: { c: Connection }) {
  const session = useWorkspace((s) => s.tabs.find((t) => t.pinnedConnectionId === c.id));
  const active = useWorkspace((s) => session !== undefined && s.activeTabId === session.id);
  const status = useSessionStatus(session);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pinned:${c.id}`,
    data: { connectionId: c.id },
  });
  const panes = session ? leaves(session.root).length : 0;
  return (
    <li className={cn(isDragging && 'opacity-50')}>
      <RowShell
        label={c.name}
        title={c.name}
        subtitle={
          session
            ? panes > 1
              ? `${String(panes)} panneaux`
              : (c.proxyJump ?? describeTarget(c))
            : describeTarget(c)
        }
        Icon={connectionIcon(c.icon)}
        iconColor={c.color}
        active={active}
        state={session ? 'live' : 'asleep'}
        status={session ? <StatusDot state={status} /> : null}
        closeLabel={`Fermer la session ${c.name}`}
        onOpen={() => {
          openConnection(c);
        }}
        onClose={session ? () => void closeTab(session.id) : undefined}
        menu={<ConnectionMenu c={c} session={session} />}
        dragProps={{ ...attributes, ...listeners }}
        buttonRef={setNodeRef}
      />
      {session && <PaneList tab={session} />}
    </li>
  );
}

function AddMenu() {
  const { readOnly, setEditing, setEditingFolder } = useConnections();
  const space = useWorkspace((s) => s.activeSpaceId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Ajouter"
          title="Nouvelle connexion ou dossier"
          disabled={readOnly}
          className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          onSelect={() => {
            setEditing(blankConnection({ spaceId: space }));
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void importWithReport()}>
          <FileDown strokeWidth={1.5} /> Importer…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportWithToast()}>
          <FileUp strokeWidth={1.5} /> Exporter…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The folders and saved connections of the active space. */
export function PinnedSection({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
  const { file, readOnly, save, setEditing } = useConnections();
  const space = useWorkspace((s) => s.activeSpaceId);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { setNodeRef, isOver } = useDroppable({ id: 'folder:' });

  const spaces = listSpaces(file);
  const folders = file.folders.filter((f) => spaceIdOf(f, spaces) === space);
  const mine = file.connections.filter((c) => connectionSpace(c, file) === space);
  const loose = mine.filter(
    (c) => c.folderId === null || !folders.some((f) => f.id === c.folderId),
  );

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveCollapsed(next);
    setCollapsed(next);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id: unknown = active.data.current?.connectionId;
    const target = typeof over?.id === 'string' ? over.id : '';
    const c = typeof id === 'string' ? file.connections.find((x) => x.id === id) : undefined;
    if (!c || readOnly || !target.startsWith('folder:')) return;
    const folderId = target.slice('folder:'.length) || null;
    if (folderId !== c.folderId) void save({ ...c, folderId, spaceId: space });
  };

  return (
    <section
      ref={setNodeRef}
      role="group"
      aria-label="Épinglés"
      className={cn('rounded-lg', isOver && 'bg-surface-2/60 ring-1 ring-ring')}
    >
      <div className="flex items-center justify-between px-2 pt-3 pb-1">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-text-muted uppercase">
          Épinglés
        </h3>
        <AddMenu />
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {folders.map((f) => (
          <Section
            key={f.id}
            title={f.name}
            color={f.color}
            dropId={`folder:${f.id}`}
            collapsed={collapsed.has(f.id)}
            onToggle={() => {
              toggle(f.id);
            }}
            menu={<FolderMenu f={f} />}
          >
            <ul className="grid gap-px">
              {mine
                .filter((c) => c.folderId === f.id)
                .map((c) => (
                  <PinnedRow key={c.id} c={c} />
                ))}
            </ul>
          </Section>
        ))}
        <ul className="grid gap-px">
          {loose.map((c) => (
            <PinnedRow key={c.id} c={c} />
          ))}
        </ul>
      </DndContext>
      {mine.length === 0 && (
        <div className="grid gap-1 px-2 py-2 text-sm text-text-muted">
          <p>Aucune connexion dans cet espace.</p>
          <button
            type="button"
            disabled={readOnly}
            className="w-fit text-left text-accent hover:underline disabled:opacity-40"
            onClick={() => {
              setEditing(blankConnection({ spaceId: space }));
            }}
          >
            Nouvelle connexion…
          </button>
          {onOpenLibrary && (
            <button
              type="button"
              className="flex w-fit items-center gap-1.5 text-left text-accent hover:underline"
              onClick={onOpenLibrary}
            >
              <Library className="size-3.5" strokeWidth={1.75} />
              Ouvrir la Bibliothèque
            </button>
          )}
        </div>
      )}
    </section>
  );
}
