import { Columns2, Maximize2, Rows2, X } from 'lucide-react';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { t } from '@/i18n';
import type { Connection } from '@/ipc/connections';
import { useWorkspace } from '@/stores/workspace';
import { MAX_VIEW_SESSIONS, viewHas, type Edge } from '@/workspace/view';
import { placeConnectionInView } from '../actions';

/** Whether a session is in its space's side-by-side view, shown or set aside. */
export function useViewMark(tabId: string | undefined): 'shown' | 'aside' | null {
  return useWorkspace((s) => {
    const view = tabId ? s.views[s.activeSpaceId] : undefined;
    if (!tabId || !view || !viewHas(view.root, tabId)) return null;
    return view.shown ? 'shown' : 'aside';
  });
}

/**
 * The first entries of a session's menu (or of a saved connection's, `tabId` `null` while
 * it has no session): open it beside the active session, or take it out of the view.
 */
export function ViewMenuItems({
  tabId,
  connection,
}: {
  tabId: string | null;
  connection?: Connection;
}) {
  const activeTabId = useWorkspace((s) => s.activeTabId);
  // Read so the entries follow the view while the menu is open.
  useWorkspace((s) => s.views);
  const mark = useViewMark(tabId ?? undefined);
  if (!activeTabId) return null;
  const ws = useWorkspace.getState();
  const can = (edge: Edge) => ws.canPlaceInView(tabId, activeTabId, edge);
  const open = (edge: Edge) => {
    if (tabId) ws.placeInView(tabId, activeTabId, edge);
    else if (connection) placeConnectionInView(connection, activeTabId, edge);
  };
  const full = tabId !== activeTabId && !can('right');
  return (
    <>
      <ContextMenuItem
        disabled={!can('right')}
        onSelect={() => {
          open('right');
        }}
      >
        <Columns2 strokeWidth={1.75} />
        {t('Ouvrir à droite')}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!can('bottom')}
        onSelect={() => {
          open('bottom');
        }}
      >
        <Rows2 strokeWidth={1.75} />
        {t('Ouvrir en bas')}
      </ContextMenuItem>
      {/* A disabled item gets no hover, so no tooltip: the reason is written under it. */}
      {full && (
        <p className="px-1.5 pb-1 text-xs text-text-muted">
          {t('{n} sessions au plus dans une vue', { n: MAX_VIEW_SESSIONS })}
        </p>
      )}
      {tabId && mark === 'shown' && (
        <>
          <ContextMenuItem
            onSelect={() => {
              ws.showAlone(tabId);
            }}
          >
            <Maximize2 strokeWidth={1.75} />
            {t('Afficher seule')}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              ws.removeFromView(tabId);
            }}
          >
            <X strokeWidth={1.75} />
            {t('Retirer de la vue')}
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
    </>
  );
}
