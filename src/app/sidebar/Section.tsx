import { useDroppable } from '@dnd-kit/core';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { Connection } from '@/ipc/connections';
import { cn } from '@/lib/utils';

/** `user@host:port`, as short as possible. */
export function describeTarget(c: Pick<Connection, 'host' | 'user' | 'port'>): string {
  const user = c.user ? `${c.user}@` : '';
  const port = c.port && c.port !== 22 ? `:${String(c.port)}` : '';
  return `${user}${c.host}${port}`;
}

/** A titled group of entries; folders can be collapsed and receive drops. */
export function Section({
  title,
  children,
  icon,
  color,
  dropId,
  collapsed,
  onToggle,
  menu,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  color?: string | null;
  /** Connections can be dropped here (`folder:<id>`, or `folder:` for the root). */
  dropId?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  menu?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `none:${title}`, disabled: !dropId });
  const heading = (
    <h3
      className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase select-none"
      onClick={onToggle}
    >
      {onToggle && (
        <ChevronRight
          className={cn('size-3 transition-transform', !collapsed && 'rotate-90')}
          strokeWidth={1.5}
        />
      )}
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {icon}
      <span className="truncate normal-case">{title}</span>
    </h3>
  );
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={title}
      className={cn('rounded-md', isOver && 'bg-surface-2/60 ring-1 ring-ring')}
    >
      {menu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{heading}</ContextMenuTrigger>
          {menu}
        </ContextMenu>
      ) : (
        heading
      )}
      {!collapsed && <div className="grid gap-px">{children}</div>}
    </div>
  );
}
