import { Component, useRef, type ReactNode } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { getPanelModule } from '@/panels/registry';
import { useConnections } from '@/stores/connections';
import { PaneHeader } from './content/PaneHeader';
import { sessionEnv } from './content/sessionEnv';
import { SlotHeader } from './content/SlotHeader';
import { slotStyle } from './content/slot';
import { useWorkspace, zoomedLeafOf } from '@/stores/workspace';
import {
  layoutRects,
  leaves,
  resizeAt,
  splitHandles,
  type Rect,
  type SplitHandle,
} from '@/workspace/tree';
import type { LeafNode, Tab } from '@/workspace/types';

const pct = (f: number) => `${String(f * 100)}%`;

/** A pane that throws while rendering shows its error; the tab and the app keep running. */
class PaneErrorBoundary extends Component<
  { title: string; onClose: () => void; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('pane crashed', error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm"
      >
        <p className="font-medium">
          {t('Le panneau « {title} » a rencontré une erreur.', { title: this.props.title })}
        </p>
        <p className="max-w-md break-words text-text-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="rounded-md border px-3 py-1 hover:bg-surface-2"
          onClick={this.props.onClose}
        >
          {t('Fermer le panneau')}
        </button>
      </div>
    );
  }
}

function Leaf({
  tab,
  leaf,
  rect,
  multi,
  visible,
  focused,
  zoomed,
}: {
  tab: Tab;
  leaf: LeafNode;
  rect: Rect;
  multi: boolean;
  visible: boolean;
  /** Its session is the active one (several sessions show side by side). */
  focused: boolean;
  /** Shown alone (`true`), hidden behind another pane shown alone (`false`), or neither. */
  zoomed: boolean | null;
}) {
  const ws = useWorkspace.getState;
  const active = tab.activeLeafId === leaf.id;
  const live = visible && focused && active;
  const module = getPanelModule(leaf.panel.kind);
  const Module = module?.component;
  return (
    <div
      className={cn(
        'absolute transition-shadow duration-150',
        multi && live && !zoomed && 'z-[1] shadow-[inset_0_0_0_1px_var(--tilde-accent)]',
        // Hidden, not unmounted: its shell keeps running.
        zoomed === false && 'hidden',
      )}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      onMouseDownCapture={() => {
        if (!active) ws().focusLeaf(tab.id, leaf.id);
      }}
    >
      <div className="flex h-full flex-col">
        {multi && <PaneHeader tab={tab} leaf={leaf} active={live} zoomed={zoomed === true} />}
        <div className="relative min-h-0 flex-1">
          {Module ? (
            <PaneErrorBoundary
              title={t(module.title)}
              onClose={() => {
                ws().closeLeaf(tab.id, leaf.id);
              }}
            >
              <Module
                tabId={tab.id}
                leafId={leaf.id}
                state={leaf.panel}
                active={live}
                visible={visible && zoomed !== false}
                update={(patch) => {
                  ws().updatePanel(tab.id, leaf.id, patch);
                }}
                close={() => {
                  ws().closeLeaf(tab.id, leaf.id);
                }}
              />
            </PaneErrorBoundary>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {t('Panneau inconnu : « {kind} »', { kind: leaf.panel.kind })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A draggable boundary between two panes. */
function Divider({
  tab,
  handle,
  container,
}: {
  tab: Tab;
  handle: SplitHandle;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const row = handle.direction === 'row';
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      // Pointer position as a fraction of the split being resized.
      const local = row
        ? ((ev.clientX - box.left) / box.width - handle.rect.x) / handle.rect.w
        : ((ev.clientY - box.top) / box.height - handle.rect.y) / handle.rect.h;
      const ws = useWorkspace.getState();
      const node = ws.tabs.find((t) => t.id === tab.id);
      const split = node && findSplit(node.root, handle.splitId);
      if (split) ws.setSizes(tab.id, split.id, resizeAt(split.sizes, handle.index, local));
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const style = row
    ? { left: pct(handle.position), top: pct(handle.span.start), height: pct(handle.span.length) }
    : { top: pct(handle.position), left: pct(handle.span.start), width: pct(handle.span.length) };

  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      className={cn(
        'group absolute z-[2] flex items-center justify-center',
        row ? 'w-2 -translate-x-1/2 cursor-col-resize' : 'h-2 -translate-y-1/2 cursor-row-resize',
      )}
      style={style}
      onPointerDown={onPointerDown}
    >
      <div
        className={cn(
          'bg-border transition-colors duration-150 group-hover:bg-primary group-active:bg-primary',
          row ? 'h-full w-px' : 'h-px w-full',
        )}
      />
    </div>
  );
}

function findSplit(node: Tab['root'], id: string): Extract<Tab['root'], { type: 'split' }> | null {
  if (node.type === 'leaf') return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSplit(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * One tab's panes, each rendered by its module (src/panels/registry). Panes are rendered
 * as a flat, absolutely positioned list keyed by pane id, so splitting or closing a pane
 * never remounts (and restarts) the others.
 * Hidden tabs stay mounted so their shells keep running.
 *
 * In a side-by-side view the session sits in `slot`, with a strip on top. The elements
 * stay the same with or without a slot: only styles change, so nothing is remounted.
 */
export function PaneView({
  tab,
  visible,
  focused = visible,
  slot = null,
}: {
  tab: Tab;
  visible: boolean;
  /** The active session (default: whether it is visible, as when sessions show alone). */
  focused?: boolean;
  /** Its place in the side-by-side view, in fractions of the content area. */
  slot?: Rect | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const file = useConnections((s) => s.file);
  const env = slot ? sessionEnv(tab, file) : null;
  const zoom = useWorkspace((s) => s.zoomed[tab.id]);
  const alone = zoom ? zoomedLeafOf(tab, { [tab.id]: zoom }) : null;
  const all = leaves(tab.root);
  const rects = layoutRects(tab.root);
  const multi = all.length > 1;
  const full: Rect = { x: 0, y: 0, w: 1, h: 1 };
  return (
    <div
      data-slot={slot ? tab.id : undefined}
      className={cn(
        'absolute',
        slot
          ? 'flex flex-col overflow-hidden rounded-lg border bg-background transition-shadow duration-150'
          : 'inset-0',
        slot && focused && 'shadow-[0_0_0_1px_var(--tilde-accent)]',
        !visible && 'hidden',
      )}
      style={
        slot
          ? {
              ...slotStyle(slot),
              borderColor: env ? `color-mix(in srgb, ${env.color} 55%, transparent)` : undefined,
            }
          : undefined
      }
      onMouseDownCapture={(e) => {
        // Its × takes it out of the view: that must not make it the active session first.
        const closing = e.target instanceof Element && e.target.closest('[data-slot-close]');
        if (slot && !focused && !closing) useWorkspace.getState().activateTab(tab.id);
      }}
    >
      {slot && <SlotHeader tab={tab} focused={focused} />}
      <div ref={container} className={cn('relative min-h-0', slot ? 'flex-1' : 'h-full')}>
        {all.map((leaf) => (
          <Leaf
            key={leaf.id}
            tab={tab}
            leaf={leaf}
            rect={alone === leaf.id ? full : (rects.get(leaf.id) ?? full)}
            multi={multi}
            visible={visible}
            focused={focused}
            zoomed={alone === null ? null : alone === leaf.id}
          />
        ))}
        {alone === null &&
          splitHandles(tab.root).map((h) => (
            <Divider
              key={`${h.splitId}:${String(h.index)}`}
              tab={tab}
              handle={h}
              container={container}
            />
          ))}
      </div>
    </div>
  );
}
