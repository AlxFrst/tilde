import { invoke } from './invoke';

/** Mirrors `Disk` in crates/tilde-monitor (bytes). */
export interface Disk {
  mount: string;
  total: number;
  used: number;
}

/** Mirrors `Snapshot` in crates/tilde-monitor. Sizes in bytes, rates in bytes/s. */
export interface Snapshot {
  /** `null` on the first sample (a rate needs two). */
  cpuPercent: number | null;
  cores: number;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  load: [number, number, number] | null;
  uptimeSecs: number;
  netRxPerSec: number | null;
  netTxPerSec: number | null;
  disks: Disk[];
  host: string;
}

/** Mirrors `MonitorErrorDto`. */
export interface MonitorErrorDto {
  kind: 'notLinux' | 'disconnected' | 'failed';
  message: string;
}

export function isMonitorError(e: unknown): e is MonitorErrorDto {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { kind?: unknown }).kind === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

export const monitorLocal = () => invoke<Snapshot>('monitor_local');
/** Reads /proc on the server of an SSH session (Linux only). */
export const monitorRemote = (sessionId: number) =>
  invoke<Snapshot>('monitor_remote', { sessionId });
