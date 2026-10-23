// What the focused terminal can do on request (palette, menus), by pane.

import { useWorkspace } from '@/stores/workspace';

export interface TerminalActions {
  focus: () => void;
  copy: () => void;
  paste: () => void;
  search: () => void;
}

const byLeaf = new Map<string, TerminalActions>();

export function registerTerminalActions(leafId: string, actions: TerminalActions): () => void {
  byLeaf.set(leafId, actions);
  return () => {
    if (byLeaf.get(leafId) === actions) byLeaf.delete(leafId);
  };
}

/** The terminal of the active pane of the active tab, if any. */
export function activeTerminal(): TerminalActions | undefined {
  const { tabs, activeTabId } = useWorkspace.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab ? byLeaf.get(tab.activeLeafId) : undefined;
}
