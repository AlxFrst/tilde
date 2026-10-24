import { Plus } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { connectionIcon } from '@/connections/icons';
import { listSpaces } from '@/connections/spaces';
import { cn } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys } from '@/terminal/keyLabels';
import { deleteSpace } from './spaceActions';

function NewSpaceButton({ compact }: { compact: boolean }) {
  const readOnly = useConnections((s) => s.readOnly);
  return (
    <button
      type="button"
      aria-label="Nouvel espace"
      title="Nouvel espace (Pro, Perso, Homelab…)"
      disabled={readOnly}
      className={cn(
        'flex shrink-0 items-center justify-center gap-2 rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40',
        compact ? 'size-8' : 'h-8 w-full justify-start px-2 text-sm',
      )}
      onClick={() => {
        useUi.getState().setSpaceDialog('new');
      }}
    >
      <Plus className="size-4" strokeWidth={1.5} />
      {!compact && <span>Nouvel espace</span>}
    </button>
  );
}

/**
 * The spaces at the bottom of the Rail. Hidden while there is only one: then only a
 * discreet « Nouvel espace » shows.
 */
export function SpaceSwitcher() {
  const file = useConnections((s) => s.file);
  const readOnly = useConnections((s) => s.readOnly);
  const active = useWorkspace((s) => s.activeSpaceId);
  const effective = useKeybindings((s) => s.effective);
  const spaces = listSpaces(file);
  if (spaces.length < 2) return <NewSpaceButton compact={false} />;
  return (
    <div role="group" aria-label="Espaces" className="flex flex-wrap items-center gap-1">
      {spaces.map((space, i) => {
        const Icon = connectionIcon(space.icon);
        const current = space.id === active;
        const binding = effective[`space.${String(i + 1)}`];
        const keys = binding ? ` (${bindingKeys(binding).join('+')})` : '';
        return (
          <ContextMenu key={space.id}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                aria-label={space.name}
                aria-pressed={current}
                title={`${space.name}${keys}`}
                // The current space wears its own colour: border and tint.
                style={{ '--chip': space.color ?? 'var(--tilde-accent)' } as CSSProperties}
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg border border-transparent transition-colors hover:bg-surface-2',
                  current && 'border-(--chip) bg-(--chip)/20 hover:bg-(--chip)/25',
                )}
                onClick={() => {
                  useWorkspace.getState().switchSpace(space.id);
                }}
              >
                <Icon
                  className="size-4"
                  strokeWidth={1.6}
                  style={{ color: space.color ?? 'var(--tilde-text-muted)' }}
                />
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-48">
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => {
                  useUi.getState().setSpaceDialog(space);
                }}
              >
                Modifier l’espace…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={readOnly}
                onSelect={() => void deleteSpace(space)}
              >
                Supprimer l’espace…
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <NewSpaceButton compact />
    </div>
  );
}
