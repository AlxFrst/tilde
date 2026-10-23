import { Activity, ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { monitorLocal, monitorRemote } from '@/ipc/monitor';
import type { PanelProps } from '@/panels/registry';
import { useSessionId } from '@/terminal/sessionRegistry';
import { cn } from '@/lib/utils';
import type { MonitorPanel } from '@/workspace/types';
import { formatBytes, formatRate, formatUptime } from './format';
import { Sparkline } from './Sparkline';
import { useSampler } from './useSampler';

/** A disk this full is shown in red. */
const FULL_PERCENT = 90;

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-surface-1 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-text-muted uppercase">
        <Icon className="size-3.5" strokeWidth={1.5} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bar({ label, used, total }: { label: string; used: number; total: number }) {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const full = percent >= FULL_PERCENT;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate font-mono">{label}</span>
        <span className="shrink-0 text-text-muted">
          {formatBytes(used)} / {formatBytes(total)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-full={full}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn('h-full rounded-full', full ? 'bg-error' : 'bg-primary')}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}

export default function MonitorPane({ state, visible }: PanelProps<MonitorPanel>) {
  const { source } = state;
  const sessionId = useSessionId(source.kind === 'remote' ? source.linkedLeafId : '');
  const remote = source.kind === 'remote';
  const fetch = useCallback(
    () => (remote ? monitorRemote(sessionId ?? -1) : monitorLocal()),
    [remote, sessionId],
  );
  const waiting = remote && sessionId === null;
  const { latest, history, error } = useSampler(fetch, visible && !waiting);

  const cpu = history.flatMap((s) => (s.cpuPercent === null ? [] : [s.cpuPercent]));
  const rx = history.map((s) => s.netRxPerSec ?? 0);
  const tx = history.map((s) => s.netTxPerSec ?? 0);

  return (
    <div className="h-full overflow-auto bg-bg p-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Activity className="size-4 self-center text-accent" strokeWidth={1.5} />
        <h2 className="text-base font-medium">
          {latest?.host ?? (remote ? 'Serveur' : 'Cette machine')}
        </h2>
        {latest && (
          <>
            <span className="text-xs text-text-muted">
              en marche depuis <span>{formatUptime(latest.uptimeSecs)}</span>
            </span>
            {latest.load && (
              <span className="text-xs text-text-muted">
                charge {latest.load.map((l) => l.toFixed(2)).join(' · ')}
              </span>
            )}
          </>
        )}
      </header>

      {waiting && <p className="text-sm text-text-muted">En attente de la connexion SSH…</p>}
      {error && (
        <p
          role="status"
          className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning"
        >
          {error.message}
        </p>
      )}

      {latest && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
          <Card icon={Cpu} title="Processeur">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {latest.cpuPercent === null ? '—' : `${String(Math.round(latest.cpuPercent))} %`}
                </div>
                <div className="text-xs text-text-muted">{latest.cores} cœurs</div>
              </div>
              <Sparkline values={cpu} max={100} label="Processeur, 2 dernières minutes" />
            </div>
          </Card>

          <Card icon={MemoryStick} title="Mémoire">
            <div className="grid gap-2">
              <Bar label="RAM" used={latest.memUsed} total={latest.memTotal} />
              {latest.swapTotal > 0 && (
                <Bar label="Swap" used={latest.swapUsed} total={latest.swapTotal} />
              )}
            </div>
          </Card>

          <Card icon={Network} title="Réseau">
            <div className="grid gap-1 text-sm tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <ArrowDown className="size-3.5 text-success" strokeWidth={1.5} />
                  {latest.netRxPerSec === null ? '—' : formatRate(latest.netRxPerSec)}
                </span>
                <Sparkline values={rx} label="Réception" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <ArrowUp className="size-3.5 text-accent-2" strokeWidth={1.5} />
                  {latest.netTxPerSec === null ? '—' : formatRate(latest.netTxPerSec)}
                </span>
                <Sparkline values={tx} label="Émission" />
              </div>
            </div>
          </Card>

          <Card icon={HardDrive} title="Disques">
            <div className="grid gap-2">
              {latest.disks.length === 0 && (
                <p className="text-xs text-text-muted">Aucun disque à afficher.</p>
              )}
              {latest.disks.map((d) => (
                <Bar key={d.mount} label={d.mount} used={d.used} total={d.total} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
