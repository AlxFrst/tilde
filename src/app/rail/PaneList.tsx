import { useWorkspace } from '@/stores/workspace';
import { cn } from '@/lib/utils';
import { leaves } from '@/workspace/tree';
import type { Tab } from '@/workspace/types';
import { paneLabel, sessionTitle, useLabelNames } from '../paneLabel';
import { focusSibling } from '../sidebar/ConnectionItem';

/** A session's panes under its row (only when it has several); a click focuses one. */
export function PaneList({ tab }: { tab: Tab }) {
  const names = useLabelNames();
  const shown = useWorkspace((s) => s.activeTabId === tab.id);
  const all = leaves(tab.root);
  if (all.length < 2) return null;
  return (
    <ul
      aria-label={`Panneaux de ${sessionTitle(tab, names)}`}
      className="ml-[15px] grid grid-cols-[minmax(0,1fr)] gap-px border-l border-border py-0.5 pl-2"
    >
      {all.map((leaf) => {
        const { title, detail, Icon } = paneLabel(tab, leaf, names);
        const current = shown && tab.activeLeafId === leaf.id;
        return (
          <li key={leaf.id}>
            <button
              type="button"
              data-sidebar-row
              aria-current={current || undefined}
              className={cn(
                'flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[0.8rem] text-text-muted outline-none',
                'hover:bg-surface-2 hover:text-text focus-visible:ring-1 focus-visible:ring-ring',
                current && 'bg-surface-2 text-text [&>svg]:text-primary',
              )}
              onClick={() => {
                const ws = useWorkspace.getState();
                ws.activateTab(tab.id);
                ws.focusLeaf(tab.id, leaf.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  focusSibling(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
                }
              }}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="shrink-0">{title}</span>
              {detail && <span className="ml-auto min-w-0 truncate text-xs">{detail}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
