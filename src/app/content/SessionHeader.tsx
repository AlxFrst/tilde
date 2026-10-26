import {
  Activity,
  Columns2,
  FolderTree,
  Minimize2,
  PanelLeftOpen,
  Plus,
  Rows2,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';
import type { Platform } from '@/ipc/app';
import { cn, SELECTED } from '@/lib/utils';
import { useConnections } from '@/stores/connections';
import { useSsh } from '@/stores/ssh';
import { useUi } from '@/stores/ui';
import { findLinked, useWorkspace, zoomedLeafOf } from '@/stores/workspace';
import { sessionsFor } from '@/terminal/sessionRegistry';
import { findLeaf } from '@/workspace/tree';
import { splitPane } from '../actions';
import { sessionTitle, useLabelNames } from '../paneLabel';
import { describeTarget } from '../sidebar/Section';
import { TransfersButton } from '../TransfersButton';
import { WindowControls } from '../WindowControls';
import { activeSshLeafId, sessionEnv } from './sessionEnv';

function HeaderButton({
  label,
  Icon,
  pressed,
  onClick,
  title,
}: {
  label: string;
  Icon: LucideIcon;
  pressed?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text',
        pressed && SELECTED,
      )}
      onClick={onClick}
    >
      <Icon className={cn('size-3.5', pressed && 'text-primary')} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}

function IconButton({
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
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      onClick={onClick}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/**
 * The top of the content: which session is shown (and its environment), what can be done
 * with it, and the window's own controls. The whole bar moves the window.
 */
export function SessionHeader({ platform }: { platform: Platform }) {
  const tab = useWorkspace((s) => s.tabs.find((x) => x.id === s.activeTabId));
  const tabs = useWorkspace((s) => s.tabs);
  const file = useConnections((s) => s.file);
  const names = useLabelNames();
  const isMac = platform === 'macos';

  const sshLeafId = tab ? activeSshLeafId(tab) : null;
  const ssh = tab && sshLeafId ? findLeaf(tab.root, sshLeafId)?.panel : undefined;
  const saved =
    ssh?.kind === 'ssh' && ssh.connectionId
      ? file.connections.find((c) => c.id === ssh.connectionId)
      : undefined;
  const env = tab ? sessionEnv(tab, file) : null;
  const filesOpen = sshLeafId !== null && findLinked(tabs, sshLeafId, 'sftp') !== null;
  const monitorDocked = sshLeafId !== null && findLinked(tabs, sshLeafId, 'monitor') !== null;
  const peeking = useUi((s) => s.peek !== null && s.peek.sshLeafId === sshLeafId);
  const railHidden = useUi((s) => s.railHidden);
  const alone = useWorkspace((s) => (tab ? zoomedLeafOf(tab, s.zoomed) : null));
  const where = saved ? describeTarget(saved) : ssh?.kind === 'ssh' ? ssh.target : null;
  const jumps = saved?.proxyJump
    ?.split(',')
    .map((j) => j.trim())
    .filter(Boolean)
    .join(' → ');
  const title = tab ? sessionTitle(tab, names) : 'Tilde';
  const split = (direction: 'row' | 'column') => {
    if (tab) splitPane(tab.id, tab.activeLeafId, direction);
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-2 pr-0 pl-3"
      style={{ paddingRight: isMac ? 12 : 0 }}
    >
      {tab && alone !== null ? (
        // A pane shown alone hides the Rail too: one click brings everything back.
        <IconButton
          label={t('Réduire le panneau')}
          Icon={Minimize2}
          onClick={() => {
            useWorkspace.getState().toggleZoom(tab.id, alone);
          }}
        />
      ) : (
        railHidden && (
          <IconButton
            label={t('Afficher la barre latérale')}
            Icon={PanelLeftOpen}
            onClick={() => {
              useUi.getState().setRailHidden(false);
            }}
          />
        )
      )}
      {env && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wider"
          style={{
            color: env.color,
            background: `color-mix(in srgb, ${env.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${env.color} 35%, transparent)`,
          }}
        >
          {env.label}
        </span>
      )}
      <span data-tauri-drag-region className="min-w-0 shrink truncate text-sm font-medium">
        {title}
      </span>
      {where && where !== title && (
        <span data-tauri-drag-region className="min-w-0 shrink truncate text-xs text-text-muted">
          {where}
        </span>
      )}
      {jumps && (
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-text-muted">
          {t('via {hosts}', { hosts: jumps })}
        </span>
      )}
      <span data-tauri-drag-region className="h-full min-w-4 flex-1" />
      {sshLeafId && (
        <>
          <HeaderButton
            label={t('Fichiers')}
            Icon={FolderTree}
            pressed={filesOpen}
            title={filesOpen ? t('Masquer les fichiers') : t('Afficher les fichiers (SFTP)')}
            onClick={() => {
              useWorkspace.getState().toggleSftp(sshLeafId);
            }}
          />
          <HeaderButton
            label={t('Moniteur')}
            Icon={Activity}
            pressed={monitorDocked || peeking}
            title={t('Processeur, mémoire, disque et réseau du serveur')}
            onClick={() => {
              // A docked monitor closes; otherwise the monitor shows over the session.
              if (monitorDocked) useWorkspace.getState().toggleRemoteMonitor(sshLeafId);
              else useUi.getState().setPeek(peeking ? null : { sshLeafId });
            }}
          />
          <HeaderButton
            label={t('Tunnels')}
            Icon={Waypoints}
            title={t('Redirections de ports de cette session')}
            onClick={() => {
              const [sessionId] = sessionsFor([sshLeafId]);
              if (sessionId !== undefined) useSsh.getState().setTunnels({ sessionId, title });
            }}
          />
          <HeaderButton
            label={t('Nouveau shell')}
            Icon={Plus}
            title={t('Un autre shell sur ce serveur')}
            onClick={() => {
              useWorkspace.getState().addShellBeside(sshLeafId);
            }}
          />
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        </>
      )}
      {tab && (
        <>
          <IconButton
            label={t('Diviser à droite')}
            Icon={Columns2}
            onClick={() => {
              split('row');
            }}
          />
          <IconButton
            label={t('Diviser en bas')}
            Icon={Rows2}
            onClick={() => {
              split('column');
            }}
          />
        </>
      )}
      <TransfersButton />
      {!isMac && <WindowControls />}
    </header>
  );
}
