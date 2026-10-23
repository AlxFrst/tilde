import { ArrowDown, ArrowDownUp, ArrowUp, FolderOpen, RotateCw, X } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  editResolve,
  transferCancel,
  transferReveal,
  transferRetry,
  transfersClear,
  type TransferInfo,
} from '@/ipc/sftp';
import { cn } from '@/lib/utils';
import { formatProgress } from '@/panels/sftp/format';
import { isActive, transferName, useTransfers } from '@/stores/transfers';

const noop = () => undefined;

const STATE_TEXT: Record<TransferInfo['state']['kind'], string> = {
  queued: 'En attente',
  running: '',
  done: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
  conflict: 'Conflit',
};

function Row({ t }: { t: TransferInfo }) {
  const Arrow = t.direction === 'download' ? ArrowDown : ArrowUp;
  const pct = t.total > 0 ? Math.min(100, (t.done / t.total) * 100) : 0;
  const icon = 'size-6';
  return (
    <li className="grid gap-1 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <div className="flex items-center gap-2">
        <Arrow className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={t.direction === 'download' ? t.local : t.remote}
        >
          {transferName(t)}
        </span>
        {isActive(t) && (
          <Button
            size="icon"
            variant="ghost"
            className={icon}
            aria-label="Annuler"
            onClick={() => void transferCancel(t.id).catch(noop)}
          >
            <X strokeWidth={1.5} />
          </Button>
        )}
        {(t.state.kind === 'failed' || t.state.kind === 'cancelled') && (
          <Button
            size="icon"
            variant="ghost"
            className={icon}
            aria-label="Réessayer"
            title="Réessayer (reprend où il s’est arrêté)"
            onClick={() => void transferRetry(t.id).catch(noop)}
          >
            <RotateCw strokeWidth={1.5} />
          </Button>
        )}
        {t.state.kind === 'done' && t.direction === 'download' && (
          <Button
            size="icon"
            variant="ghost"
            className={icon}
            aria-label="Afficher dans le dossier"
            onClick={() => void transferReveal(t.id).catch(noop)}
          >
            <FolderOpen strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {t.state.kind === 'running' && (
        <div className="h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${String(pct)}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          'text-xs text-text-muted',
          (t.state.kind === 'failed' || t.state.kind === 'conflict') && 'text-error',
        )}
      >
        {t.state.kind === 'running'
          ? formatProgress(t.done, t.total, t.bytesPerSec)
          : t.state.kind === 'failed' || t.state.kind === 'conflict'
            ? `${STATE_TEXT[t.state.kind]} : ${t.state.message}`
            : STATE_TEXT[t.state.kind]}
      </p>
      {t.state.kind === 'conflict' && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void editResolve(t.id, true).catch(noop)}
          >
            Écraser
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void editResolve(t.id, false).catch(noop)}
          >
            Prendre la version du serveur
          </Button>
        </div>
      )}
    </li>
  );
}

/** In the titlebar: how many transfers run, overall progress, and the list. */
export function TransfersButton() {
  const byId = useTransfers((s) => s.transfers);
  const transfers = useMemo(() => Object.values(byId), [byId]);
  if (transfers.length === 0) return null;
  const active = transfers.filter(isActive);
  const total = active.reduce((sum, t) => sum + t.total, 0);
  const done = active.reduce((sum, t) => sum + t.done, 0);
  const progress = total > 0 ? done / total : 0;
  const attention = transfers.some((t) => t.state.kind === 'conflict' || t.state.kind === 'failed');
  const circumference = 2 * Math.PI * 9;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            active.length > 0 ? `Transferts : ${String(active.length)} en cours` : 'Transferts'
          }
          className="relative mr-1 flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
        >
          {active.length > 0 && (
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 28 28" aria-hidden>
              <circle
                cx="14"
                cy="14"
                r="9"
                fill="none"
                stroke="var(--tilde-accent)"
                strokeWidth="2"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
              />
            </svg>
          )}
          <ArrowDownUp className="size-3.5" strokeWidth={1.5} />
          {(active.length > 0 || attention) && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full px-0.5 text-center text-[9px] leading-3.5 text-white',
                attention ? 'bg-error' : 'bg-primary',
              )}
            >
              {active.length > 0 ? active.length : '!'}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-xs font-medium tracking-wide text-text-muted uppercase">
            Transferts
          </span>
          <button
            type="button"
            className="text-xs text-text-muted hover:text-text"
            onClick={() => {
              void transfersClear().then(() => {
                useTransfers.setState((s) => ({
                  transfers: Object.fromEntries(
                    Object.entries(s.transfers).filter(
                      ([, t]) => isActive(t) || t.state.kind === 'conflict',
                    ),
                  ),
                }));
              });
            }}
          >
            Effacer les terminés
          </button>
        </div>
        <ul className="grid max-h-96 gap-0.5 overflow-y-auto">
          {[...transfers].reverse().map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
