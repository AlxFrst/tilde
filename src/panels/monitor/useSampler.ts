import { useEffect, useRef, useState } from 'react';
import { isMonitorError, type MonitorErrorDto, type Snapshot } from '@/ipc/monitor';

/** Samples kept for the sparklines (2 minutes at the default interval). */
export const HISTORY = 60;
/** Longest wait between two tries after failures. */
const MAX_BACKOFF_MS = 30_000;

export interface Sampler {
  latest: Snapshot | null;
  history: Snapshot[];
  error: MonitorErrorDto | null;
}

const asError = (err: unknown): MonitorErrorDto =>
  isMonitorError(err)
    ? err
    : { kind: 'failed', message: err instanceof Error ? err.message : String(err) };

/**
 * Calls `fetch` every `intervalMs` while `active` (a visible pane). After a failure the
 * wait doubles (4, 8, 16… up to 30 s) and the error stays the same object while its
 * message does not change, so a dead server shows one message, not a storm.
 */
export function useSampler(
  fetch: () => Promise<Snapshot>,
  active: boolean,
  intervalMs = 2000,
): Sampler {
  const [state, setState] = useState<Sampler>({ latest: null, history: [], error: null });
  const failures = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await fetch();
        if (cancelled) return;
        failures.current = 0;
        setState((prev) => ({
          latest: s,
          history: [...prev.history, s].slice(-HISTORY),
          error: null,
        }));
      } catch (err) {
        if (cancelled) return;
        failures.current++;
        const e = asError(err);
        setState((prev) =>
          prev.error?.message === e.message && prev.error.kind === e.kind
            ? prev
            : { ...prev, error: e },
        );
      }
      const wait =
        failures.current === 0
          ? intervalMs
          : Math.min(intervalMs * 2 ** failures.current, MAX_BACKOFF_MS);
      timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetch, active, intervalMs]);

  return state;
}
