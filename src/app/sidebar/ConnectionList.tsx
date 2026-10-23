import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { History, Server, Star } from 'lucide-react';
import { useState } from 'react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import type { Connection, Folder, Recent } from '@/ipc/connections';
import { connectionIcon } from '@/connections/icons';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { openConnection } from '../actions';
import { confirmAction } from '../confirm';
import { SidebarRow } from './ConnectionItem';
import { Section, describeTarget } from './Section';
import { adoptedAliases, SshConfigSection } from './SshConfigSection';

const MAX_SHOWN_RECENTS = 5;
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

/** Context menu of a saved connection. */
export function ConnectionMenu({ c }: { c: Connection }) {
  const { readOnly, file, save, remove, setFavorite, setEditing } = useConnections();
  return (
    <ContextMenuContent className="min-w-48">
      <ContextMenuItem
        onSelect={() => {
          openConnection(c);
        }}
      >
        Ouvrir
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          setEditing(c);
        }}
      >
        Modifier…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void save({ ...c, id: '', name: `${c.name} (copie)`, favorite: false });
        }}
      >
        Dupliquer
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void setFavorite(c.id, !c.favorite);
        }}
      >
        {c.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={readOnly}>Déplacer vers</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            disabled={c.folderId === null}
            onSelect={() => {
              void save({ ...c, folderId: null });
            }}
          >
            Sans dossier
          </ContextMenuItem>
          {file.folders.map((f) => (
            <ContextMenuItem
              key={f.id}
              disabled={c.folderId === f.id}
              onSelect={() => {
                void save({ ...c, folderId: f.id });
              }}
            >
              {f.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={readOnly}
        onSelect={() => {
          void confirmAction({
            title: `Supprimer « ${c.name} » ?`,
            description: 'Les onglets déjà ouverts restent connectés.',
            confirmLabel: 'Supprimer',
            destructive: true,
          }).then((ok) => (ok ? remove(c.id) : undefined));
        }}
      >
        Supprimer
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function FolderMenu({ f }: { f: Folder }) {
  const { readOnly, removeFolder, setEditingFolder, setEditing } = useConnections();
  return (
    <ContextMenuContent className="min-w-48">
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          setEditing(blankConnection({ folderId: f.id }));
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
            description: 'Ses connexions sont conservées et passent dans « Sans dossier ».',
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

export function ConnectionRow({ c, section }: { c: Connection; section: string }) {
  return (
    <SidebarRow
      Icon={connectionIcon(c.icon)}
      color={c.color}
      title={c.name}
      subtitle={describeTarget(c)}
      onOpen={() => {
        openConnection(c);
      }}
      menu={<ConnectionMenu c={c} />}
      dragId={`${section}:${c.id}`}
      dragData={{ connectionId: c.id }}
    />
  );
}

function RecentRow({ r, byId }: { r: Recent; byId: Map<string, Connection> }) {
  const saved = r.key.startsWith('conn:') ? byId.get(r.key.slice(5)) : undefined;
  if (saved) return <ConnectionRow c={saved} section="recent" />;
  if (!r.key.startsWith('ssh:')) return null;
  const target = r.key.slice(4);
  return (
    <SidebarRow
      Icon={History}
      title={r.label}
      onOpen={() => {
        useWorkspace.getState().openSshTab(target);
      }}
    />
  );
}

/** Favorites, recents, folders, ungrouped, then ~/.ssh/config — empty sections hidden. */
export function ConnectionList() {
  const { file, readOnly, sshHosts, save } = useConnections();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const byId = new Map(file.connections.map((c) => [c.id, c]));
  const favorites = file.connections.filter((c) => c.favorite);
  const recents = file.recents
    .filter((r) => !r.key.startsWith('conn:') || byId.has(r.key.slice(5)))
    .slice(0, MAX_SHOWN_RECENTS);
  const ungrouped = file.connections.filter((c) => c.folderId === null);
  const adopted = adoptedAliases(file.connections);
  const freeHosts = sshHosts.filter((h) => !adopted.has(h.alias));

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
    const c = typeof id === 'string' ? byId.get(id) : undefined;
    if (!c || readOnly || !target.startsWith('folder:')) return;
    const folderId = target.slice('folder:'.length) || null;
    if (folderId !== c.folderId) void save({ ...c, folderId });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div data-sidebar-list className="px-2 pb-2">
        {favorites.length > 0 && (
          <Section title="Favoris" icon={<Star className="size-3" strokeWidth={1.5} />}>
            {favorites.map((c) => (
              <ConnectionRow key={c.id} c={c} section="fav" />
            ))}
          </Section>
        )}
        {recents.length > 0 && (
          <Section title="Récents">
            {recents.map((r) => (
              <RecentRow key={r.key} r={r} byId={byId} />
            ))}
          </Section>
        )}
        {file.folders.map((f) => {
          const inside = file.connections.filter((c) => c.folderId === f.id);
          return (
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
              {inside.length === 0 ? (
                <p className="px-2 py-1 text-xs text-text-muted">Glissez une connexion ici</p>
              ) : (
                inside.map((c) => <ConnectionRow key={c.id} c={c} section="folder" />)
              )}
            </Section>
          );
        })}
        {ungrouped.length > 0 && (
          <Section title="Sans dossier" dropId="folder:">
            {ungrouped.map((c) => (
              <ConnectionRow key={c.id} c={c} section="root" />
            ))}
          </Section>
        )}
        {freeHosts.length > 0 && <SshConfigSection hosts={freeHosts} />}
        {file.connections.length === 0 && freeHosts.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 pt-10 text-center">
            <div className="rounded-lg bg-surface-2 p-3 text-text-muted">
              <Server className="size-5" strokeWidth={1.5} />
            </div>
            <p className="text-text-muted">Aucune connexion pour l’instant</p>
          </div>
        )}
      </div>
    </DndContext>
  );
}
