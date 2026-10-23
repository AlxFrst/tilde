import { Server, Settings2 } from 'lucide-react';
import type { Appearance } from '@/ipc/generated/settings';
import { cn } from '@/lib/utils';

interface SidebarProps {
  side: Appearance['sidebarPosition'];
  width: number;
  onOpenSettings: () => void;
}

export function Sidebar({ side, width, onOpenSettings }: SidebarProps) {
  return (
    <aside
      aria-label="Connexions"
      data-side={side}
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col bg-surface-1',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <div className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
        Connexions
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="rounded-lg bg-surface-2 p-3 text-text-muted">
          <Server className="size-5" strokeWidth={1.5} />
        </div>
        <p className="text-text-muted">Aucune connexion pour l’instant</p>
      </div>
      <div className="border-t p-2">
        <button
          type="button"
          aria-label="Réglages"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Settings2 className="size-4" strokeWidth={1.5} />
          <span>Réglages</span>
        </button>
      </div>
    </aside>
  );
}
