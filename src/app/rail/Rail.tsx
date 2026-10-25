import { Library, PanelLeftClose, Search } from 'lucide-react';
import { t, tn } from '@/i18n';
import { tRust } from '@/i18n/rust';
import { openConnectionsFile } from '@/ipc/connections';
import { formatConfigError } from '@/ipc/errors';
import type { Appearance } from '@/ipc/generated/settings';
import { cn } from '@/lib/utils';
import { listSpaces } from '@/connections/spaces';
import { useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys } from '@/terminal/keyLabels';
import { Logo } from '../Logo';
import { FavoriteTiles } from './FavoriteTiles';
import { PinnedSection } from './PinnedSection';
import { RailFooter } from './RailFooter';
import { SpaceSwitcher } from '../spaces/SpaceSwitcher';
import { TodaySection } from './TodaySection';

export interface RailProps {
  side: Appearance['sidebarPosition'];
  width: number;
  onOpenSettings: () => void;
  /** Leaves room for macOS's traffic lights in the top-left corner. */
  macInset?: boolean;
}

/** Opens the Library; says how many ~/.ssh/config hosts wait there. */
function LibraryButton() {
  const hosts = useConnections((s) => s.sshHosts.length);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      onClick={() => {
        useUi.getState().setLibraryOpen(true);
      }}
    >
      <Library className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex min-w-0 flex-col">
        <span className="text-text">{t('Bibliothèque')}</span>
        {hosts > 0 && (
          <span className="truncate text-xs">
            ~/.ssh/config · {tn(hosts, '{count} hôte', '{count} hôtes')}
          </span>
        )}
      </span>
    </button>
  );
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
      <span className="min-w-0 flex-1 truncate">{t('Rechercher, se connecter, agir…')}</span>
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
export function Rail({ side, width, onOpenSettings, macInset = false }: RailProps) {
  const { readOnly, error, warnings, file } = useConnections();
  const activeSpace = useWorkspace((s) => s.activeSpaceId);
  const tint = listSpaces(file).find((s) => s.id === activeSpace)?.color ?? null;
  return (
    <aside
      aria-label={t('Barre latérale')}
      data-side={side}
      // Arc's signature: the Rail takes a hint of the space's colour.
      style={
        tint
          ? ({
              width,
              '--tilde-space': tint,
              background: 'color-mix(in srgb, var(--tilde-space) 7%, var(--tilde-surface-1))',
            } as React.CSSProperties)
          : { width }
      }
      className={cn(
        'flex min-h-0 shrink-0 flex-col gap-2 bg-surface-1 pt-2',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center gap-2 px-3 text-sm font-medium"
        style={macInset ? { paddingLeft: 78 } : undefined}
      >
        <Logo className="size-[18px]" />
        <span data-tauri-drag-region className="flex-1">
          Tilde
        </span>
        <button
          type="button"
          aria-label={t('Masquer la barre latérale')}
          title={t('Masquer la barre latérale ({keys})', {
            keys: bindingKeys('Ctrl+Shift+B').join('+'),
          })}
          className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          onClick={() => {
            useUi.getState().setRailHidden(true);
          }}
        >
          <PanelLeftClose className="size-4" strokeWidth={1.5} />
        </button>
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
            {t('Ouvrir le fichier')}
          </button>
        </div>
      )}
      {!readOnly && warnings.length > 0 && (
        <div
          role="status"
          className="mx-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"
        >
          <p className="font-medium">{t('À corriger avant de pouvoir s’y connecter :')}</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{tRust(w)}</li>
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
        <PinnedSection
          onOpenLibrary={() => {
            useUi.getState().setLibraryOpen(true);
          }}
        />
        <TodaySection />
      </div>

      <RailFooter onOpenSettings={onOpenSettings}>
        <LibraryButton />
        <SpaceSwitcher />
      </RailFooter>
    </aside>
  );
}
