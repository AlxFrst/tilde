// Which backend session runs in which pane, for close confirmations.

const sessions = new Map<string, number>();

export function registerSession(leafId: string, id: number): void {
  sessions.set(leafId, id);
}

export function unregisterSession(leafId: string): void {
  sessions.delete(leafId);
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
