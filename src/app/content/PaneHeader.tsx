import { Columns2, Maximize2, Minimize2, Rows2, X, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/stores/workspace';
import type { LeafNode, Tab } from '@/workspace/types';
import { closePane, splitPane } from '../actions';
import { paneLabel, useLabelNames } from '../paneLabel';

function PaneAction({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      onClick={onClick}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** The strip above a pane when its session has several: its name, zoom, split, close. */
export function PaneHeader({
  tab,
  leaf,
  active,
  zoomed,
}: {
  tab: Tab;
  leaf: LeafNode;
  active: boolean;
  /** Shown alone in its session. */
  zoomed: boolean;
}) {
  const names = useLabelNames();
  const { title, owner, detail, Icon } = paneLabel(tab, leaf, names);
  const name = owner ? `${title} · ${owner}` : title;
  return (
    <div
      role="toolbar"
      aria-label={t('Panneau {name}', { name })}
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 text-xs',
        active ? 'text-text' : 'text-text-muted',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', active && 'text-primary')} strokeWidth={1.75} />
      <span className="shrink-0 font-medium">{title}</span>
      {owner && <span className="shrink-0 text-text-muted">· {owner}</span>}
      {detail && <span className="min-w-0 truncate font-mono text-text-muted">{detail}</span>}
      <span className="flex-1" />
      <PaneAction
        label={zoomed ? t('Réduire le panneau') : t('Agrandir le panneau')}
        Icon={zoomed ? Minimize2 : Maximize2}
        onClick={() => {
          useWorkspace.getState().toggleZoom(tab.id, leaf.id);
        }}
      />
      <PaneAction
        label={t('Diviser à droite')}
        Icon={Columns2}
        onClick={() => {
          splitPane(tab.id, leaf.id, 'row');
        }}
      />
      <PaneAction
        label={t('Diviser en bas')}
        Icon={Rows2}
        onClick={() => {
          splitPane(tab.id, leaf.id, 'column');
        }}
      />
      <PaneAction
        label={t('Fermer ce panneau')}
        Icon={X}
        onClick={() => void closePane(tab.id, leaf.id)}
      />
    </div>
  );
}
