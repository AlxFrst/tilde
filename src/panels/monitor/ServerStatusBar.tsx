import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { monitorRemote } from '@/ipc/monitor';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { useSessionId } from '@/terminal/sessionRegistry';
import { formatBytes, formatRate } from './format';
import { useSampler } from './useSampler';

/** Slower than the monitor pane: the strip is a glance, not a graph. */
const INTERVAL_MS = 3000;
/** Above this, a figure turns amber. */
const BUSY_PERCENT = 90;

function Item({
  Icon,
  label,
  busy,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <span title={label} className={cn('flex shrink-0 items-center gap-1', busy && 'text-warning')}>
      <Icon className="size-3 shrink-0" strokeWidth={1.5} aria-label={label} />
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

/**
 * A one-line strip under an SSH terminal: the server's CPU, memory, root disk and
 * network. Hidden on servers it cannot read (not Linux) and while the pane is not shown.
 */
export function ServerStatusBar({ leafId, visible }: { leafId: string; visible: boolean }) {
  const enabled = useSettings((s) => s.settings?.ssh.statusBar ?? false);
  const sessionId = useSessionId(leafId);
  const fetch = useCallback(() => monitorRemote(sessionId ?? -1), [sessionId]);
  const { latest, error } = useSampler(
    fetch,
    enabled && visible && sessionId !== null,
    INTERVAL_MS,
  );

  if (!enabled || sessionId === null || error?.kind === 'notLinux') return null;

  const root = latest?.disks.find((d) => d.mount === '/') ?? latest?.disks[0];
  const mem = latest ? percent(latest.memUsed, latest.memTotal) : 0;
  const disk = root ? percent(root.used, root.total) : 0;

  return (
    <div
      role="status"
      aria-label="État du serveur"
      className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t bg-surface-1 px-2 text-[11px] whitespace-nowrap text-text-muted"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {latest ? (
          <>
            <span className="max-w-[40%] shrink-0 truncate font-medium text-text">
              {latest.host}
            </span>
            <Item Icon={Cpu} label="Processeur" busy={(latest.cpuPercent ?? 0) >= BUSY_PERCENT}>
              {latest.cpuPercent === null ? '—' : `${String(Math.round(latest.cpuPercent))} %`}
            </Item>
            <Item Icon={MemoryStick} label="Mémoire" busy={mem >= BUSY_PERCENT}>
              {formatBytes(latest.memUsed)} / {formatBytes(latest.memTotal)}
            </Item>
            {root && (
              <Item Icon={HardDrive} label={`Disque ${root.mount}`} busy={disk >= BUSY_PERCENT}>
                {root.mount} {Math.round(disk)} %
              </Item>
            )}
            {latest.netRxPerSec !== null && (
              <Item Icon={ArrowDown} label="Réseau, reçu">
                {formatRate(latest.netRxPerSec)}
              </Item>
            )}
            {latest.netTxPerSec !== null && (
              <Item Icon={ArrowUp} label="Réseau, envoyé">
                {formatRate(latest.netTxPerSec)}
              </Item>
            )}
          </>
        ) : (
          <span title={error?.message}>
            {error ? 'Statistiques du serveur indisponibles' : 'Statistiques du serveur…'}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="Détails"
          title="Moniteur détaillé du serveur"
          className="flex h-5 items-center gap-1 rounded px-1 hover:bg-surface-2 hover:text-text"
          onClick={() => {
            useWorkspace.getState().toggleRemoteMonitor(leafId);
          }}
        >
          <Activity className="size-3" strokeWidth={1.5} />
          <span>Détails</span>
        </button>
        <button
          type="button"
          aria-label="Masquer le bandeau"
          title="Masquer le bandeau (réactivable dans Réglages → SSH)"
          className="flex size-5 items-center justify-center rounded hover:bg-surface-2 hover:text-text"
          onClick={() => {
            void useSettings.getState().update({ ssh: { statusBar: false } });
            toast('Bandeau masqué', { description: 'Réactivable dans Réglages → SSH.' });
          }}
        >
          <X className="size-3" strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}
