import { Search } from 'lucide-react';
import { openConnectionsFile } from '@/ipc/connections';
import { formatConfigError } from '@/ipc/errors';
import type { Appearance } from '@/ipc/generated/settings';
import { cn } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useUi } from '@/stores/ui';
import { bindingKeys } from '@/terminal/keyLabels';
import { Logo } from '../Logo';
import { FavoriteTiles } from './FavoriteTiles';
import { PinnedSection } from './PinnedSection';
import { RailFooter } from './RailFooter';
import { TodaySection } from './TodaySection';

export interface RailProps {
  side: Appearance['sidebarPosition'];
  width: number;
  onOpenSettings: () => void;
}

/** Opens the command palette; shows its shortcut so it is learnt by looking. */
function SearchButton() {
  const binding = useKeybindings((s) => s.effective['palette.toggle'] ?? null);
  return (
    <button
      type="button"
      className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 text-left text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      onClick={() => {
        useUi.getState().setPaletteOpen(true);
      }}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">Rechercher, se connecter, agir…</span>
      {binding && (
        <span className="flex shrink-0 gap-0.5">
          {bindingKeys(binding).map((k) => (
            <kbd
              key={k}
              className="rounded bg-surface-2 px-1 font-mono text-[0.65rem] text-text-muted"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * The Rail: the main window's only navigation. Favourites, the space's saved connections
 * (« Épinglés ») and its other sessions (« Aujourd’hui »), above a fixed footer.
 */
export function Rail({ side, width, onOpenSettings }: RailProps) {
  const { readOnly, error, warnings } = useConnections();
  return (
    <aside
      aria-label="Barre latérale"
      data-side={side}
      style={{ width }}
      className={cn(
        'flex min-h-0 shrink-0 flex-col gap-2 bg-surface-1 pt-2',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center gap-2 px-3 text-sm font-medium"
      >
        <Logo className="size-[18px]" />
        <span data-tauri-drag-region>Tilde</span>
      </div>
      <div className="flex shrink-0 flex-col px-2">
        <SearchButton />
      </div>

      {readOnly && error && (
        <div
          role="alert"
          className="mx-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <p>{formatConfigError(error, 'connections.json')}</p>
          <button
            type="button"
            className="mt-1 underline"
            onClick={() => void openConnectionsFile()}
          >
            Ouvrir le fichier
          </button>
        </div>
      )}
      {!readOnly && warnings.length > 0 && (
        <div
          role="status"
          className="mx-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"
        >
          <p className="font-medium">À corriger avant de pouvoir s’y connecter :</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        data-rail-scroll
        data-sidebar-list
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2 pb-2"
      >
        <FavoriteTiles />
        <PinnedSection />
        <TodaySection />
      </div>

      <RailFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
}
