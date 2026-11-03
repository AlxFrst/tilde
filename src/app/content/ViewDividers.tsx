import type { RefObject } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/stores/workspace';
import { resizeAt, type SplitHandle } from '@/workspace/tree';
import { viewHandles, viewSplitOf, type ViewNode } from '@/workspace/view';

const pct = (f: number) => `${String(f * 100)}%`;
/** The smallest share a session keeps when its neighbour grows (percent of its split). */
const MIN_SLOT = 15;

/** A draggable boundary between two sessions of the view. */
function ViewDivider({
  handle,
  area,
}: {
  handle: SplitHandle;
  area: RefObject<HTMLElement | null>;
}) {
  const row = handle.direction === 'row';
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      // Pointer position as a fraction of the split being resized.
      const local = row
        ? ((ev.clientX - box.left) / box.width - handle.rect.x) / handle.rect.w
        : ((ev.clientY - box.top) / box.height - handle.rect.y) / handle.rect.h;
      const ws = useWorkspace.getState();
      const view = ws.views[ws.activeSpaceId];
      const split = view && viewSplitOf(view.root, handle.splitId);
      if (split) ws.setViewSizes(split.id, resizeAt(split.sizes, handle.index, local, MIN_SLOT));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const style = row
    ? {
        left: pct(handle.position),
        top: `calc(${pct(handle.span.start)} + 3px)`,
        height: `calc(${pct(handle.span.length)} - 6px)`,
      }
    : {
        top: pct(handle.position),
        left: `calc(${pct(handle.span.start)} + 3px)`,
        width: `calc(${pct(handle.span.length)} - 6px)`,
      };
  return (
    <div
      role="separator"
      aria-label={t('Séparation des sessions')}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      className={cn(
        'group absolute z-[3] flex items-center justify-center',
        row ? 'w-2 -translate-x-1/2 cursor-col-resize' : 'h-2 -translate-y-1/2 cursor-row-resize',
      )}
      style={style}
      onPointerDown={onPointerDown}
    >
      <div
        className={cn(
          'rounded-full bg-transparent transition-colors duration-150 group-hover:bg-primary group-active:bg-primary',
          row ? 'h-10 w-0.5' : 'h-0.5 w-10',
        )}
      />
    </div>
  );
}

/** The boundaries between the sessions shown side by side, over the content area. */
export function ViewDividers({
  view,
  area,
}: {
  view: ViewNode;
  area: RefObject<HTMLElement | null>;
}) {
  return viewHandles(view).map((h) => (
    <ViewDivider key={`${h.splitId}:${String(h.index)}`} handle={h} area={area} />
  ));
}
