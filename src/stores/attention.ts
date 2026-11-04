// Sessions where something happened while the user was not looking (a long command
// ended, a program asked for attention, the bell): the Rail marks them until they are
// seen. Seen = this window has the focus and the session is on screen. Each window keeps
// its own (its front only runs its own sessions).

import { create } from 'zustand';
import { tabsOnScreen, useWorkspace } from './workspace';

interface AttentionState {
  /** The sessions (tab ids) marked in the Rail. */
  marked: Readonly<Record<string, true>>;
  /** This window has the focus (kept up to date by useAttentionTracking). */
  windowFocused: boolean;
  mark: (tabId: string) => void;
  setWindowFocused: (focused: boolean) => void;
}

export const useAttention = create<AttentionState>((set, get) => ({
  marked: {},
  windowFocused: true,
  mark: (tabId) => {
    if (!get().marked[tabId]) set({ marked: { ...get().marked, [tabId]: true } });
  },
  setWindowFocused: (windowFocused) => {
    if (get().windowFocused !== windowFocused) set({ windowFocused });
  },
}));

/** The user is looking at this session: the window has the focus and it is on screen. */
export function isSeen(tabId: string): boolean {
  return (
    useAttention.getState().windowFocused && tabsOnScreen(useWorkspace.getState()).includes(tabId)
  );
}

/** Drops the marks of the sessions seen now, and of those that are closed. */
export function clearSeen(): void {
  const { marked } = useAttention.getState();
  const ids = Object.keys(marked);
  if (ids.length === 0) return;
  const open = new Set(useWorkspace.getState().tabs.map((t) => t.id));
  const keep = ids.filter((id) => open.has(id) && !isSeen(id));
  if (keep.length === ids.length) return;
  useAttention.setState({ marked: Object.fromEntries(keep.map((id) => [id, true as const])) });
}

/**
 * Clears a mark as soon as its session is seen: when it is shown, or when the window gets
 * the focus back. Returns the function that stops watching.
 */
export function watchAttention(): () => void {
  clearSeen();
  const offWorkspace = useWorkspace.subscribe(clearSeen);
  const offAttention = useAttention.subscribe(clearSeen);
  return () => {
    offWorkspace();
    offAttention();
  };
}
