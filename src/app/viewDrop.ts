// Dragging a session from the Rail onto the content: beside a session (near an edge) or
// in its place (the centre). The drag itself belongs to the Rail's sections (dnd-kit);
// this follows the pointer over the content area and tells them what a drop would do.

import type { Active, DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import { t } from '@/i18n';
import { useConnections } from '@/stores/connections';
import { useUi, type ViewDropPreview } from '@/stores/ui';
import { shownView, useWorkspace } from '@/stores/workspace';
import type { Rect } from '@/workspace/tree';
import {
  dropPreview,
  dropZoneAt,
  MAX_VIEW_SESSIONS,
  viewHas,
  viewRects,
  type DropZone,
} from '@/workspace/view';
import { placeConnectionInView } from './actions';
import { sessionTitle, type LabelNames } from './paneLabel';

/** What is dragged: a session, or a saved connection whose session is not open yet. */
export type DragSource = { tabId: string } | { connectionId: string };

export interface ViewDropTarget {
  targetTabId: string;
  zone: DropZone;
  /** The target session's place, in fractions of the content area. */
  slot: Rect;
}

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** The session under (`x`, `y`) (client pixels) and where in it, or `null` off the content. */
export function viewDropTarget(x: number, y: number): ViewDropTarget | null {
  const area = document.querySelector('[data-view-area]');
  if (!area) return null;
  const box = area.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const s = useWorkspace.getState();
  const view = shownView(s);
  const slots = view ? viewRects(view) : new Map(s.activeTabId ? [[s.activeTabId, FULL]] : []);
  for (const [targetTabId, slot] of slots) {
    const inside = fx >= slot.x && fx <= slot.x + slot.w && fy >= slot.y && fy <= slot.y + slot.h;
    if (inside) return { targetTabId, zone: dropZoneAt(slot, fx, fy), slot };
  }
  return null;
}

/** The session a drag source is, if it is open. */
function tabOf(source: DragSource): string | null {
  if ('tabId' in source) return source.tabId;
  const open = useWorkspace
    .getState()
    .tabs.find((x) => x.pinnedConnectionId === source.connectionId);
  return open?.id ?? null;
}

/** What dropping `source` on `target` would do, or `null` when it would do nothing. */
export function previewFor(
  source: DragSource,
  target: ViewDropTarget | null,
  names: LabelNames,
): ViewDropPreview | null {
  if (!target) return null;
  const s = useWorkspace.getState();
  const tabId = tabOf(source);
  const targetTab = s.tabs.find((x) => x.id === target.targetTabId);
  if (tabId === target.targetTabId || !targetTab) return null;
  if (!s.canPlaceInView(tabId, target.targetTabId, target.zone)) {
    // From the Rail (one space), the only refusal left is a full view.
    return {
      rect: target.slot,
      label: t('{n} sessions au plus dans une vue', { n: MAX_VIEW_SESSIONS }),
      bad: true,
    };
  }
  const name = sessionTitle(targetTab, names);
  const view = shownView(s);
  const inView = tabId !== null && view !== null && viewHas(view, tabId);
  const label = {
    left: t('À gauche de {name}', { name }),
    right: t('À droite de {name}', { name }),
    top: t('Au-dessus de {name}', { name }),
    bottom: t('En dessous de {name}', { name }),
    center: inView ? t('Échanger avec {name}', { name }) : t('À la place de {name}', { name }),
  }[target.zone];
  return { rect: dropPreview(target.slot, target.zone), label, bad: false };
}

function dropOnView(source: DragSource, target: ViewDropTarget): void {
  if ('tabId' in source) {
    useWorkspace.getState().placeInView(source.tabId, target.targetTabId, target.zone);
    return;
  }
  const c = useConnections.getState().file.connections.find((x) => x.id === source.connectionId);
  if (c) placeConnectionInView(c, target.targetTabId, target.zone);
}

/** Where the pointer is during a dnd-kit drag (client pixels). */
function pointerOf(e: { activatorEvent: Event | null; delta: { x: number; y: number } }) {
  const start = e.activatorEvent;
  if (!start || !('clientX' in start) || !('clientY' in start)) return null;
  const { clientX, clientY } = start as PointerEvent;
  return { x: clientX + e.delta.x, y: clientY + e.delta.y };
}

/**
 * The drag handlers a Rail section adds to its DndContext. `onDragEnd` returns `true` when
 * the drop was on the content (the section then does not reorder).
 */
export function viewDragHandlers(
  sourceOf: (active: Active) => DragSource | null,
  names: LabelNames,
) {
  const targetOf = (e: DragMoveEvent | DragEndEvent) => {
    const source = sourceOf(e.active);
    const p = pointerOf(e);
    return { source, target: source && p ? viewDropTarget(p.x, p.y) : null };
  };
  return {
    onDragStart: () => {
      useUi.getState().setRailDragging(true);
    },
    onDragMove: (e: DragMoveEvent) => {
      const { source, target } = targetOf(e);
      useUi.getState().setViewDrop(source ? previewFor(source, target, names) : null);
    },
    onDragCancel: () => {
      useUi.getState().setViewDrop(null);
      useUi.getState().setRailDragging(false);
    },
    onDragEnd: (e: DragEndEvent): boolean => {
      const { source, target } = targetOf(e);
      useUi.getState().setViewDrop(null);
      useUi.getState().setRailDragging(false);
      if (!source || !target) return false;
      const preview = previewFor(source, target, names);
      if (preview && !preview.bad) dropOnView(source, target);
      return true;
    },
  };
}
