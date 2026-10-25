import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { t } from '@/i18n';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { isPinnedTab, spaceOfTab } from '@/workspace/spaces';
import { bindingKeys } from '@/terminal/keyLabels';
import type { Tab } from '@/workspace/types';
import { openDefaultTab } from '../actions';
import { NewTabMenu } from '../NewTabMenu';
import { SessionRow } from './SessionRow';

function SortableSession({ tab }: { tab: Tab }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  return (
    <div
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : undefined}
    >
      <SessionRow tab={tab} dragProps={{ ...attributes, ...listeners }} buttonRef={setNodeRef} />
    </div>
  );
}

/** The sessions of the active space that are not pinned to a connection. */
export function TodaySection() {
  const tabs = useWorkspace((s) => s.tabs);
  const space = useWorkspace((s) => s.activeSpaceId);
  // Pins follow connections.json: re-read it so a deleted connection's session moves here.
  const file = useConnections((s) => s.file);
  const today = useMemo(
    () => tabs.filter((x) => spaceOfTab(x) === space && !isPinnedTab(x)),
    // `file` changes the resolver's answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, space, file],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = useWorkspace.getState().tabs.map((x) => x.id);
    useWorkspace.getState().moveTab(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <section role="group" aria-label={t('Aujourd’hui')} className="grid gap-px">
      <div className="flex items-center gap-2 px-2 pt-4 pb-1">
        <h3 className="text-[0.7rem] font-medium tracking-wider text-text-muted uppercase">
          {t('Aujourd’hui')}
        </h3>
        <span className="h-px flex-1 bg-border" />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={today.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-px">
            {today.map((x) => (
              <SortableSession key={x.id} tab={x} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="mt-1 flex items-center gap-0.5">
        <button
          type="button"
          aria-label={t('Nouvelle session')}
          title={t('Nouvelle session ({keys})', { keys: bindingKeys('Ctrl+Shift+T').join('+') })}
          className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-dashed border-border px-2 text-left text-sm text-text-muted hover:bg-surface-2 hover:text-text"
          onClick={openDefaultTab}
        >
          <Plus className="size-4" strokeWidth={1.75} />
          {t('Nouvelle session')}
        </button>
        <NewTabMenu />
      </div>
    </section>
  );
}
