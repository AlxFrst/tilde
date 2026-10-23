import { useDraggable } from '@dnd-kit/core';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

/** Moves focus between sidebar entries with ↑/↓. */
export function focusSibling(from: HTMLElement, delta: 1 | -1): void {
  const rows = Array.from(
    from.closest('[data-sidebar-list]')?.querySelectorAll<HTMLElement>('[data-sidebar-row]') ?? [],
  );
  rows[rows.indexOf(from) + delta]?.focus();
}

export interface RowProps {
  Icon: LucideIcon;
  color?: string | null;
  title: string;
  subtitle?: string;
  onOpen: () => void;
  /** Context menu content (`ContextMenuContent`). */
  menu?: ReactNode;
  /** A button shown on hover, beside the entry. */
  action?: ReactNode;
  /** Set for saved connections: they can be dragged onto a folder. */
  dragId?: string;
  dragData?: Record<string, unknown>;
}

/** One entry of the sidebar: double click or Enter opens it. */
export function SidebarRow({
  Icon,
  color,
  title,
  subtitle,
  onOpen,
  menu,
  action,
  dragId,
  dragData,
}: RowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId ?? `static:${title}`,
    data: dragData,
    disabled: !dragId,
  });
  const row = (
    <button
      type="button"
      data-sidebar-row
      ref={setNodeRef}
      {...(dragId ? attributes : {})}
      {...(dragId ? listeners : {})}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left outline-none',
        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-1 focus-visible:ring-ring',
        isDragging && 'opacity-50',
      )}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          focusSibling(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      <Icon
        className="size-4 shrink-0"
        strokeWidth={1.5}
        style={{ color: color ?? 'var(--tilde-text-muted)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {subtitle && <span className="block truncate text-xs text-text-muted">{subtitle}</span>}
      </span>
    </button>
  );
  return (
    <div className="group relative flex min-w-0 items-center">
      {menu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          {menu}
        </ContextMenu>
      ) : (
        row
      )}
      {action && (
        <div className="absolute right-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {action}
        </div>
      )}
    </div>
  );
}
