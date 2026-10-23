import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/stores/workspace';
import { openDefaultTab } from './actions';

/** The Quake window (created by Rust under this label) loads the same page. */
export const QUAKE_LABEL = 'quake';

export function isQuakeWindow(label: string = getCurrentWindow().label): boolean {
  return label === QUAKE_LABEL;
}

/** Time for the closing panes to ask Rust to end their sessions before the window goes. */
const SHUTDOWN_GRACE_MS = 100;

/**
 * Quake window: closing its last tab hides it, and a fresh tab is ready for the next
 * time it is summoned. When Quake is turned off, Rust asks the window to close its tabs
 * (ending their sessions) and it then destroys itself.
 */
export function useQuakeTabs(enabled = true): void {
  const empty = useWorkspace((s) => s.tabs.length === 0);
  const hadTabs = useRef(false);
  const shuttingDown = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const off = listen('quake://shutdown', () => {
      shuttingDown.current = true;
      useWorkspace.setState({ tabs: [], activeTabId: null });
      setTimeout(() => {
        void getCurrentWindow().destroy();
      }, SHUTDOWN_GRACE_MS);
    });
    return () => {
      void off.then((f) => {
        f();
      });
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || shuttingDown.current) return;
    if (!empty) {
      hadTabs.current = true;
      return;
    }
    if (!hadTabs.current) return;
    hadTabs.current = false;
    void getCurrentWindow().hide();
    openDefaultTab();
  }, [empty, enabled]);
}
