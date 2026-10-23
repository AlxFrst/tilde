import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FolderTree, Plus, Server, X } from 'lucide-react';
import { useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { getPanelModule } from '@/panels/registry';
import { useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { cn } from '@/lib/utils';
import { sessionsFor } from '@/terminal/sessionRegistry';
import { findLeaf, leaves } from '@/workspace/tree';
import type { Tab } from '@/workspace/types';
import { closeTab, openDefaultTab } from './actions';
import { StatusDot } from './ConnectionStatus';
import { NewTabMenu } from './NewTabMenu';
import { profileIcon } from './profileIcon';

const TAB_COLORS = [
  ['Pervenche', 'var(--tilde-accent)'],
  ['Turquoise', 'var(--tilde-accent-2)'],
  ['Vert', 'var(--tilde-success)'],
  ['Ambre', 'var(--tilde-warning)'],
  ['Rouge', 'var(--tilde-error)'],
] as const;

function useTabLabel(tab: Tab) {
  const profiles = useProfiles((s) => s.profiles);
  const active = findLeaf(tab.root, tab.activeLeafId) ?? leaves(tab.root)[0];
  // A files pane is labelled by the SSH pane it belongs to.
  const leaf =
    active?.panel.kind === 'sftp'
      ? (findLeaf(tab.root, active.panel.linkedLeafId) ?? active)
      : active;
  const panel = leaf?.panel;
  const connection = useSsh((s) => (leaf ? s.states[leaf.id] : undefined));
  const saved = useConnections((s) =>
    panel?.kind === 'ssh' && panel.connectionId
      ? s.file.connections.find((c) => c.id === panel.connectionId)
      : undefined,
  );
  if (panel?.kind === 'ssh') {
    const title = tab.customTitle ?? panel.title ?? saved?.name ?? panel.target;
    return { title, Icon: Server, profileColor: null, leaf, panel, connection };
  }
  if (panel?.kind === 'sftp') {
    return {
      title: tab.customTitle ?? 'Fichiers',
      Icon: FolderTree,
      profileColor: null,
      leaf,
      panel,
      connection,
    };
  }
  // Any other pane (editor, preview, monitor, plugins): its module names it.
  const kind: string = panel?.kind ?? 'terminal';
  if (panel && kind !== 'terminal') {
    const module = getPanelModule(kind);
    return {
      title: tab.customTitle ?? module?.tabTitle?.(panel) ?? module?.title ?? kind,
      Icon: module?.icon ?? FolderTree,
      profileColor: null,
      leaf,
      panel,
      connection,
    };
  }
  const term = panel?.kind === 'terminal' ? panel : undefined;
  const profile = profiles.find((p) => p.id === term?.profileId);
  const title = tab.customTitle ?? term?.title ?? profile?.name ?? term?.profileId ?? '';
  return {
    title,
    Icon: profileIcon(profile?.icon),
    profileColor: profile?.color ?? null,
    leaf,
    panel,
    connection,
  };
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const ws = useWorkspace.getState;
  const { title, Icon, profileColor, leaf, panel, connection } = useTabLabel(tab);
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  const commit = (value: string) => {
    ws().renameTab(tab.id, value);
    setEditing(false);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          {...attributes}
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          className={cn(
            'group relative flex h-[calc(100%-4px)] max-w-52 min-w-28 items-center gap-2 rounded-t-md border border-b-0 px-3 text-sm select-none',
            active
              ? 'bg-background text-text'
              : 'border-transparent text-text-muted hover:bg-surface-2',
            isDragging && 'z-10 opacity-80',
          )}
          onMouseDown={(e) => {
            if (e.button === 0) ws().activateTab(tab.id);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) void closeTab(tab.id);
          }}
          onDoubleClick={() => {
            setEditing(true);
          }}
          {...listeners}
        >
          <Icon
            className="size-3.5 shrink-0"
            strokeWidth={1.5}
            style={{ color: profileColor ?? (active ? 'var(--tilde-accent)' : undefined) }}
          />
          {editing ? (
            <input
              aria-label="Nom de l’onglet"
              autoFocus
              defaultValue={title}
              className="w-full min-w-0 rounded bg-surface-2 px-1 outline-none"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(e.currentTarget.value);
                else if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={(e) => {
                commit(e.currentTarget.value);
              }}
            />
          ) : (
            <span className="truncate">{title}</span>
          )}
          {panel?.kind === 'ssh' && !editing && <StatusDot state={connection} />}
          {!editing && (
            <button
              type="button"
              aria-label="Fermer l’onglet"
              className="ml-auto rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-2"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={() => void closeTab(tab.id)}
            >
              <X className="size-3" strokeWidth={1.5} />
            </button>
          )}
          {tab.color && (
            <span
              className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
              style={{ background: tab.color }}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            setEditing(true);
          }}
        >
          Renommer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuLabel>Couleur</ContextMenuLabel>
        <div className="flex gap-1.5 px-2 pb-1.5">
          {TAB_COLORS.map(([name, color]) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              className={cn(
                'size-4 rounded-full ring-offset-2 ring-offset-popover',
                tab.color === color && 'ring-2 ring-ring',
              )}
              style={{ background: color }}
              onClick={() => {
                ws().setTabColor(tab.id, color);
              }}
            />
          ))}
          <button
            type="button"
            aria-label="Aucune couleur"
            className="size-4 rounded-full border"
            onClick={() => {
              ws().setTabColor(tab.id, null);
            }}
          />
        </div>
        <ContextMenuSeparator />
        {panel?.kind === 'ssh' && leaf && (
          <ContextMenuItem
            onSelect={() => {
              ws().openSftpBeside(leaf.id);
            }}
          >
            Fichiers…
          </ContextMenuItem>
        )}
        {panel?.kind === 'ssh' && leaf && (
          <ContextMenuItem
            onSelect={() => {
              const [sessionId] = sessionsFor([leaf.id]);
              if (sessionId !== undefined) useSsh.getState().setTunnels({ sessionId, title });
            }}
          >
            Tunnels…
          </ContextMenuItem>
        )}
        {panel?.kind === 'ssh' && leaf && (
          <ContextMenuItem
            onSelect={() => {
              ws().openMonitor(leaf.id, { kind: 'remote', linkedLeafId: leaf.id });
            }}
          >
            Moniteur du serveur…
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => {
            if (panel?.kind === 'ssh') ws().openSshTab(panel.target, panel.connectionId);
            else if (panel?.kind === 'terminal') ws().openTab(panel.profileId, panel.cwd);
          }}
        >
          Dupliquer
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void closeTab(tab.id)}>Fermer</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabBar() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = useWorkspace.getState().tabs.map((t) => t.id);
    useWorkspace.getState().moveTab(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b bg-surface-1 px-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div
            role="tablist"
            aria-label="Onglets"
            className="flex h-full min-w-0 items-end gap-1 overflow-x-auto"
          >
            {tabs.map((t) => (
              <TabItem key={t.id} tab={t} active={t.id === activeTabId} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="mb-1 flex items-center self-center">
        <button
          type="button"
          aria-label="Nouvel onglet"
          title="Nouvel onglet (Ctrl+Maj+T)"
          className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          onClick={openDefaultTab}
        >
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
        <NewTabMenu />
      </div>
    </div>
  );
}
