import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { slotStyle } from './slot';

/** Where a session dragged from the Rail would land: a dashed box and what it would do. */
export function ViewDropOverlay() {
  const drop = useUi((s) => s.viewDrop);
  if (!drop) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-30 grid place-items-center rounded-lg border-[1.5px] border-dashed',
        drop.bad ? 'border-destructive bg-destructive/10' : 'border-primary bg-primary/15',
      )}
      style={slotStyle(drop.rect)}
    >
      <span className="rounded-md border bg-surface-2 px-2.5 py-1 text-xs shadow-sm">
        {drop.label}
      </span>
    </div>
  );
}
