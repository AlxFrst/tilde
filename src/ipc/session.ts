import { Channel, invoke } from '@tauri-apps/api/core';

/** Mirrors `SessionErrorDto` in src-tauri/src/commands/session.rs. */
export interface SessionErrorDto {
  kind: 'profileNotFound' | 'spawn' | 'notFound' | 'io';
  message: string;
}

export function isSessionError(value: unknown): value is SessionErrorDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

type SessionEvent = { type: 'exit'; code: number | null };

export interface OpenSessionOptions {
  profileId: string;
  cwd?: string | null;
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
  onExit: (code: number | null) => void;
}

/** Raw channel payloads arrive as an ArrayBuffer (or a plain array on older runtimes). */
function toBytes(message: unknown): Uint8Array {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return Uint8Array.from(message as number[]);
}

/** Starts a shell. Output is streamed as bytes; acknowledge it with `ackSession`. */
export async function openSession(
  o: OpenSessionOptions,
): Promise<{ id: number; profileId: string }> {
  const output = new Channel<unknown>();
  output.onmessage = (m) => {
    o.onData(toBytes(m));
  };
  const events = new Channel<SessionEvent>();
  // `exit` is the only event today; dispatch on `e.type` once there are more.
  events.onmessage = (e) => {
    o.onExit(e.code);
  };
  return invoke('session_open', {
    profileId: o.profileId,
    cwd: o.cwd ?? null,
    cols: o.cols,
    rows: o.rows,
    output,
    events,
  });
}

const encoder = new TextEncoder();

/** Sends keyboard input as a raw body; the session id travels in a header. */
export function writeSession(id: number, data: string | Uint8Array): Promise<void> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return invoke('session_write', bytes, { headers: { 'x-session-id': String(id) } });
}

export const resizeSession = (id: number, cols: number, rows: number) =>
  invoke<undefined>('session_resize', { id, cols, rows });
export const ackSession = (id: number, bytes: number) =>
  invoke<undefined>('session_ack', { id, bytes });
export const closeSession = (id: number) => invoke<undefined>('session_close', { id });
export const isSessionBusy = (id: number) => invoke<boolean>('session_busy', { id });
export const openUrl = (url: string) => invoke<undefined>('open_url', { url });
