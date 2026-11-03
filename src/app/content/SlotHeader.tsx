import { X, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import type { Tab } from '@/workspace/types';
import { sessionTitle, useLabelNames } from '../paneLabel';
import { useSessionIcon } from '../rail/SessionRow';
import { sessionWhere } from './sessionEnv';

function StripIcon({ Icon, focused }: { Icon: LucideIcon; focused: boolean }) {
  return (
    <Icon
      className={cn('size-3.5 shrink-0', focused ? 'text-primary' : 'text-text-muted')}
      strokeWidth={1.75}
    />
  );
}

/**
 * The strip on top of a session shown side by side: which session it is, and × to take
 * it out of the view (it keeps running, its row stays in the Rail).
 */
export function SlotHeader({ tab, focused }: { tab: Tab; focused: boolean }) {
  const names = useLabelNames();
  const file = useConnections((s) => s.file);
  const Icon = useSessionIcon(tab);
  const title = sessionTitle(tab, names);
  const where = sessionWhere(tab, file);
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 border-b pr-1 pl-2.5 text-xs',
        focused ? 'bg-primary/10' : 'bg-surface-1',
      )}
    >
      <StripIcon Icon={Icon} focused={focused} />
      <span className="shrink-0 font-medium">{title}</span>
      {where && where !== title && (
        <span className="min-w-0 truncate text-text-muted">{where}</span>
      )}
      <span className="min-w-2 flex-1" />
      <button
        type="button"
        data-slot-close
        aria-label={t('Retirer {name} de la vue', { name: title })}
        title={t('Retirer de la vue')}
        className="flex size-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text"
        // The keyboard stays in the active session's terminal.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          useWorkspace.getState().removeFromView(tab.id);
        }}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
