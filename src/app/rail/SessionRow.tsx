import { Server, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { listSpaces, spaceName } from '@/connections/spaces';
import { t, tn } from '@/i18n';
import { cn } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useWorkspace } from '@/stores/workspace';
import { isPinnedTab, spaceOfTab } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import type { Tab } from '@/workspace/types';
import { closeTab, closeTabs } from '../actions';
import { StatusDot } from '../ConnectionStatus';
import { paneLabel, sessionTitle, useLabelNames } from '../paneLabel';
import { profileIcon } from '../profileIcon';
import { focusSibling } from '../sidebar/ConnectionItem';
import { moveSessionToSpace } from '../spaces/spaceActions';
import { TAB_COLORS } from '../tabColors';
import { PaneList } from './PaneList';
import { useSessionStatus } from './sessionStatus';

const ws = () => useWorkspace.getState();

/**
 * « 3 panneaux », under a session with several. Not `{count}`: the i18n test keeps
 * « {count} panneau(x) » without English to check the French plural rule.
 */
export const paneCount = (n: number): string => tn(n, '{n} panneau', '{n} panneaux', { n });

/** The saved connection a session's first SSH pane opened, if it still exists. */
export function useSessionConnectionId(tab: Tab): string | null {
  const connections = useConnections((s) => s.file.connections);
  const ssh = leaves(tab.root).find((l) => l.panel.kind === 'ssh')?.panel;
  const id = ssh?.kind === 'ssh' ? ssh.connectionId : null;
  return id && connections.some((c) => c.id === id) ? id : null;
}

function useSessionIcon(tab: Tab): LucideIcon {
  const profiles = useProfiles((s) => s.profiles);
  const names = useLabelNames();
  const first = leaves(tab.root)[0];
  if (!first) return Server;
  if (leaves(tab.root).some((l) => l.panel.kind === 'ssh')) return Server;
  if (first.panel.kind === 'terminal') {
    const { profileId } = first.panel;
    return profileIcon(profiles.find((p) => p.id === profileId)?.icon);
  }
  return paneLabel(tab, first, names).Icon;
}

/** « Déplacer vers l’espace » (only when there are several spaces). */
export function MoveToSpace({ tabId, current }: { tabId: string; current: string }) {
  const file = useConnections((s) => s.file);
  const spaces = listSpaces(file);
  if (spaces.length < 2) return null;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t('Déplacer vers l’espace')}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {spaces.map((s) => (
          <ContextMenuItem
            key={s.id}
            disabled={s.id === current}
            onSelect={() => void moveSessionToSpace(tabId, s.id)}
          >
            {spaceName(s)}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** What a session's menu offers: name, colour, copy, pin, close (several ways). */
export function SessionMenuItems({ tab, onRename }: { tab: Tab; onRename: () => void }) {
  const connectionId = useSessionConnectionId(tab);
  const pinned = isPinnedTab(tab);
  const below = useWorkspace((s) => s.tabsAfter(tab.id).length);
  const others = useWorkspace((s) => s.otherTabs(tab.id).length);
  const first = leaves(tab.root)[0]?.panel;
  return (
    <>
      <ContextMenuItem onSelect={onRename}>{t('Renommer')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuLabel>{t('Couleur')}</ContextMenuLabel>
      <div className="flex gap-1.5 px-2 pb-1.5">
        {TAB_COLORS.map(([name, color]) => (
          <button
            key={name}
            type="button"
            aria-label={t(name)}
            className={cn(
              'size-4 rounded-full ring-offset-2 ring-offset-popover',
              tab.color === color && 'ring-2 ring-ring',
            )}
            style={{ background: color }}
            onClick={() => {
              ws().setTabColor(tab.id, color);
            }}
          />
        ))}
        <button
          type="button"
          aria-label={t('Aucune couleur')}
          className="size-4 rounded-full border"
          onClick={() => {
            ws().setTabColor(tab.id, null);
          }}
        />
      </div>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => {
          if (first?.kind === 'ssh') ws().openSshTab(first.target, first.connectionId);
          else if (first?.kind === 'terminal') ws().openTab(first.profileId, first.cwd);
        }}
      >
        {t('Dupliquer')}
      </ContextMenuItem>
      {pinned ? (
        <ContextMenuItem
          onSelect={() => {
            ws().unpinTab(tab.id);
          }}
        >
          {t('Désépingler la session')}
        </ContextMenuItem>
      ) : (
        connectionId && (
          <ContextMenuItem
            onSelect={() => {
              ws().pinTab(tab.id, connectionId);
            }}
          >
            {t('Épingler')}
          </ContextMenuItem>
        )
      )}
      <MoveToSpace tabId={tab.id} current={spaceOfTab(tab)} />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void closeTab(tab.id)}>{t('Fermer')}</ContextMenuItem>
      <ContextMenuItem
        disabled={others === 0}
        onSelect={() => void closeTabs(ws().otherTabs(tab.id))}
      >
        {t('Fermer les autres')}
      </ContextMenuItem>
      {!pinned && (
        <ContextMenuItem
          disabled={below === 0}
          onSelect={() => void closeTabs(ws().tabsAfter(tab.id))}
        >
          {t('Fermer celles en dessous')}
        </ContextMenuItem>
      )}
    </>
  );
}

/** The field that replaces a row's title while it is renamed. */
function RenameField({ tab, title, onDone }: { tab: Tab; title: string; onDone: () => void }) {
  const commit = (value: string) => {
    // Unchanged, the name stays a live one (the connection's, « Session 2 »…).
    if (value.trim() !== title) ws().renameTab(tab.id, value);
    onDone();
  };
  return (
    <input
      aria-label={t('Nom de la session')}
      autoFocus
      defaultValue={title}
      className="h-8 w-full min-w-0 rounded-md bg-surface-2 px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(e.currentTarget.value);
        else if (e.key === 'Escape') onDone();
      }}
      onBlur={(e) => {
        commit(e.currentTarget.value);
      }}
    />
  );
}

export interface RowShellProps {
  label: string;
  title: string;
  subtitle?: string | null;
  Icon: LucideIcon;
  iconColor?: string | null;
  active: boolean;
  /** `asleep` (pinned, not open) or `live`. */
  state?: 'asleep' | 'live';
  status?: ReactNode;
  closeLabel?: string;
  onOpen: () => void;
  onClose?: () => void;
  onRename?: () => void;
  menu: ReactNode;
  accent?: string | null;
  /** Spread onto the button (drag handle). */
  dragProps?: Record<string, unknown>;
  buttonRef?: (el: HTMLElement | null) => void;
}

/** One row of the Rail: a click opens, a middle click closes, a double click renames. */
export function RowShell({
  label,
  title,
  subtitle,
  Icon,
  iconColor,
  active,
  state,
  status,
  closeLabel,
  onOpen,
  onClose,
  onRename,
  menu,
  accent,
  dragProps,
  buttonRef,
}: RowShellProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative flex min-w-0 items-center">
          <button
            type="button"
            ref={buttonRef}
            data-sidebar-row
            data-state={state}
            aria-label={label}
            aria-current={active || undefined}
            {...dragProps}
            className={cn(
              'flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-1 text-left outline-none',
              'hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-ring',
              active && 'border-border bg-surface-2',
              state === 'asleep' && 'text-text-muted',
            )}
            onClick={onOpen}
            onDoubleClick={onRename}
            onAuxClick={(e) => {
              if (e.button === 1) onClose?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                focusSibling(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
              }
            }}
          >
            <Icon
              className={cn('size-4 shrink-0', state === 'asleep' && 'opacity-70')}
              strokeWidth={1.6}
              style={{ color: iconColor ?? 'var(--tilde-text-muted)' }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{title}</span>
              {subtitle && (
                <span className="block truncate text-xs text-text-muted">{subtitle}</span>
              )}
            </span>
            {/* The close button appears over this spot: the dot gives way to it. */}
            <span
              className={cn(
                'flex shrink-0 empty:hidden',
                onClose && 'transition-opacity group-focus-within:opacity-0 group-hover:opacity-0',
              )}
            >
              {status}
            </span>
            {accent && (
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 w-0.5 rounded-full"
                style={{ background: accent }}
              />
            )}
          </button>
          {onClose && (
            <button
              type="button"
              aria-label={closeLabel ?? t('Fermer {name}', { name: title })}
              className="absolute right-1.5 flex size-5 items-center justify-center rounded text-text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-1 hover:text-text"
              onClick={onClose}
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
}

/** A session of « Aujourd’hui », or one more session under a pinned connection. */
export function SessionRow({
  tab,
  label,
  dragProps,
  buttonRef,
}: {
  tab: Tab;
  /** Its name where the context says the rest (« Session 2 » under its connection). */
  label?: string;
  dragProps?: Record<string, unknown>;
  buttonRef?: (el: HTMLElement | null) => void;
}) {
  const names = useLabelNames();
  const title = label && !tab.customTitle ? label : sessionTitle(tab, names);
  const active = useWorkspace((s) => s.activeTabId === tab.id);
  const status = useSessionStatus(tab);
  const Icon = useSessionIcon(tab);
  const [editing, setEditing] = useState(false);
  const shells = leaves(tab.root).length;
  const first = leaves(tab.root)[0];
  const detail = first && shells === 1 ? paneLabel(tab, first, names).detail : null;
  return (
    <li>
      {editing ? (
        <RenameField
          tab={tab}
          title={title}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <RowShell
          label={title}
          title={title}
          subtitle={shells > 1 ? paneCount(shells) : detail}
          Icon={Icon}
          active={active}
          status={<StatusDot state={status} />}
          accent={tab.color}
          onOpen={() => {
            ws().activateTab(tab.id);
          }}
          onClose={() => void closeTab(tab.id)}
          onRename={() => {
            setEditing(true);
          }}
          dragProps={dragProps}
          buttonRef={buttonRef}
          menu={
            <ContextMenuContent className="min-w-52">
              <SessionMenuItems
                tab={tab}
                onRename={() => {
                  setEditing(true);
                }}
              />
            </ContextMenuContent>
          }
        />
      )}
      <PaneList tab={tab} />
    </li>
  );
}
