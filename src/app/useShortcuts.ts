import { useEffect } from 'react';
import { useWorkspace } from '@/stores/workspace';
import { matchShortcut, type CommandId } from '@/terminal/keys';
import { closeActivePane, closeTab, openDefaultTab } from './actions';

/** App-level commands. `terminal.*` commands are handled by the focused TerminalView. */
const APP_COMMANDS: Partial<Record<CommandId, () => void>> = {
  'tab.new': openDefaultTab,
  'tab.close': () => {
    const id = useWorkspace.getState().activeTabId;
    if (id) void closeTab(id);
  },
  'tab.next': () => {
    useWorkspace.getState().activateRelative(1);
  },
  'tab.prev': () => {
    useWorkspace.getState().activateRelative(-1);
  },
  'pane.splitRight': () => {
    useWorkspace.getState().splitActive('row');
  },
  'pane.splitDown': () => {
    useWorkspace.getState().splitActive('column');
  },
  'pane.close': () => void closeActivePane(),
  'pane.focusLeft': () => {
    useWorkspace.getState().focusNeighbor('left');
  },
  'pane.focusRight': () => {
    useWorkspace.getState().focusNeighbor('right');
  },
  'pane.focusUp': () => {
    useWorkspace.getState().focusNeighbor('up');
  },
  'pane.focusDown': () => {
    useWorkspace.getState().focusNeighbor('down');
  },
};

/** Listens in the capture phase so shortcuts win over the focused terminal. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = matchShortcut(e);
      const run = command ? APP_COMMANDS[command] : undefined;
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) run();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);
}
