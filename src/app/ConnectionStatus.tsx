import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { msg, t } from '@/i18n';
import { tRust } from '@/i18n/rust';
import type { ConnState } from '@/ipc/ssh';
import { cn } from '@/lib/utils';
import { statusTone, type StatusTone } from '@/stores/ssh';

const TONE: Record<StatusTone, { label: string; color: string }> = {
  ok: { label: msg('Connecté'), color: 'var(--tilde-success)' },
  busy: { label: msg('Connexion en cours'), color: 'var(--tilde-warning)' },
  bad: { label: msg('Connexion perdue'), color: 'var(--tilde-error)' },
};

/** The tab's dot: green ready, amber connecting or reconnecting, red lost or failed. */
export function StatusDot({ state }: { state: ConnState | undefined }) {
  const tone = statusTone(state);
  if (!tone) return null;
  const label = t(TONE[tone].label);
  const { color } = TONE[tone];
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn('size-2 shrink-0 rounded-full', tone === 'busy' && 'animate-pulse')}
      style={{ background: color }}
    />
  );
}

/**
 * What the pane says about its connection; `null` once it is simply connected. The reason
 * of a loss and the message of a failure are written by Rust.
 */
export function connectionMessage(state: ConnState | null): string | null {
  switch (state?.kind) {
    case 'resolving':
      return t('Préparation de la connexion…');
    case 'connecting':
      return t('Connexion à {hop}…', { hop: state.hop });
    case 'lost':
      return t('Connexion perdue : {reason}', { reason: tRust(state.reason) });
    case 'reconnecting':
      return t('Reconnexion dans {seconds} s… (tentative {attempt})', {
        seconds: state.inSecs,
        attempt: state.attempt,
      });
    case 'failed':
      return tRust(state.message);
    default:
      return null;
  }
}

/** A strip over the top of an SSH pane while it is not simply connected. */
export function ConnectionBanner({
  state,
  onRetry,
  retryLabel,
}: {
  state: ConnState | null;
  onRetry: () => void;
  /** Defaults to « Réessayer »; already translated. */
  retryLabel?: string;
}) {
  const message = connectionMessage(state);
  if (!message) return null;
  const tone = statusTone(state ?? undefined) ?? 'busy';
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b bg-surface-1/95 px-3 py-1.5 text-sm"
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: TONE[tone].color }} />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {state?.kind === 'failed' && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw strokeWidth={1.5} /> {retryLabel ?? t('Réessayer')}
        </Button>
      )}
    </div>
  );
}
