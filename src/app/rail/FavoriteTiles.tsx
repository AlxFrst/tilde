import { connectionIcon } from '@/connections/icons';
import { connectionSpace } from '@/connections/spaces';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { openConnection } from '../actions';
import { describeTarget } from '../sidebar/Section';

const MAX_TILES = 8;

/** The favourite connections of the active space, as tiles at the top of the Rail. */
export function FavoriteTiles() {
  const file = useConnections((s) => s.file);
  const space = useWorkspace((s) => s.activeSpaceId);
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const favorites = file.connections
    .filter((c) => c.favorite && connectionSpace(c, file) === space)
    .slice(0, MAX_TILES);
  if (favorites.length === 0) return null;
  return (
    <div role="group" aria-label={t('Favoris')} className="grid grid-cols-4 gap-1.5 px-1 pt-1">
      {favorites.map((c) => {
        const Icon = connectionIcon(c.icon);
        const session = tabs.find((x) => x.pinnedConnectionId === c.id);
        const active = session !== undefined && session.id === activeTabId;
        return (
          <button
            key={c.id}
            type="button"
            aria-label={c.name}
            title={`${c.name} — ${describeTarget(c)}`}
            className={cn(
              'relative flex h-11 items-center justify-center rounded-lg border bg-surface-1 transition-colors hover:bg-surface-2',
              active && 'border-ring bg-surface-2',
            )}
            onClick={() => {
              openConnection(c);
            }}
          >
            <Icon
              className="size-[18px]"
              strokeWidth={1.6}
              style={{ color: c.color ?? 'var(--tilde-text-muted)' }}
            />
            {session && (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-success"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
