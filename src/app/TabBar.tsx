import { House, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function TabBar() {
  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b bg-surface-1 px-2">
      <div role="tablist" aria-label="Onglets" className="flex h-full items-end gap-1">
        <button
          type="button"
          role="tab"
          aria-selected
          className="flex h-[calc(100%-4px)] items-center gap-2 rounded-t-md border border-b-0 bg-background px-3 text-sm"
        >
          <House className="size-3.5 text-primary" strokeWidth={1.5} />
          Accueil
        </button>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled <button> swallows hover events, so the tooltip wraps a span. */}
          <span className="mb-1 self-center">
            <button
              type="button"
              disabled
              aria-label="Nouvel onglet"
              className="flex size-6 items-center justify-center rounded-md text-text-muted opacity-50"
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Disponible en phase 2</TooltipContent>
      </Tooltip>
    </div>
  );
}
