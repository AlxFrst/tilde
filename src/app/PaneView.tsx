import { Component, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { getPanelModule } from '@/panels/registry';
import { PaneHeader } from './content/PaneHeader';
import { useWorkspace } from '@/stores/workspace';
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
        <p className="font-medium">Le panneau « {this.props.title} » a rencontré une erreur.</p>
        <p className="max-w-md break-words text-text-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="rounded-md border px-3 py-1 hover:bg-surface-2"
          onClick={this.props.onClose}
        >
          Fermer le panneau
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
}: {
  tab: Tab;
  leaf: LeafNode;
  rect: Rect;
  multi: boolean;
  visible: boolean;
}) {
  const ws = useWorkspace.getState;
  const active = tab.activeLeafId === leaf.id;
  const module = getPanelModule(leaf.panel.kind);
  const Module = module?.component;
  return (
    <div
      className={cn(
        'absolute transition-shadow duration-150',
        multi && active && 'z-[1] shadow-[inset_0_0_0_1px_var(--tilde-accent)]',
      )}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      onMouseDownCapture={() => {
        if (!active) ws().focusLeaf(tab.id, leaf.id);
      }}
    >
      <div className="flex h-full flex-col">
        {multi && <PaneHeader tab={tab} leaf={leaf} active={visible && active} />}
        <div className="relative min-h-0 flex-1">
          {Module ? (
            <PaneErrorBoundary
              title={module.title}
              onClose={() => {
                ws().closeLeaf(tab.id, leaf.id);
              }}
            >
              <Module
                tabId={tab.id}
                leafId={leaf.id}
                state={leaf.panel}
                active={visible && active}
                visible={visible}
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
              Panneau inconnu : « {leaf.panel.kind} »
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
 */
export function PaneView({ tab, visible }: { tab: Tab; visible: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const all = leaves(tab.root);
  const rects = layoutRects(tab.root);
  const multi = all.length > 1;
  return (
    <div ref={container} className={cn('absolute inset-0', !visible && 'hidden')}>
      {all.map((leaf) => (
        <Leaf
          key={leaf.id}
          tab={tab}
          leaf={leaf}
          rect={rects.get(leaf.id) ?? { x: 0, y: 0, w: 1, h: 1 }}
          multi={multi}
          visible={visible}
        />
      ))}
      {splitHandles(tab.root).map((h) => (
        <Divider
          key={`${h.splitId}:${String(h.index)}`}
          tab={tab}
          handle={h}
          container={container}
        />
      ))}
    </div>
  );
}
