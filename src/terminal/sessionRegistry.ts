// Which backend session runs in which pane: close confirmations, tunnels, files.

import { useSyncExternalStore } from 'react';

const sessions = new Map<string, number>();
const listeners = new Set<() => void>();

const changed = () => {
  listeners.forEach((l) => {
    l();
  });
};

export function registerSession(leafId: string, id: number): void {
  sessions.set(leafId, id);
  changed();
}

export function unregisterSession(leafId: string): void {
  if (sessions.delete(leafId)) changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session running in a pane, kept up to date (`null` while none). */
export function useSessionId(leafId: string): number | null {
  return useSyncExternalStore(subscribe, () => sessions.get(leafId) ?? null);
}

export function sessionsFor(leafIds: string[]): number[] {
  return leafIds.flatMap((l) => {
    const id = sessions.get(l);
    return id === undefined ? [] : [id];
  });
}

export function allSessions(): number[] {
  return [...sessions.values()];
}
