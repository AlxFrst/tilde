import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/stores/workspace';
import { openDefaultTab } from './actions';

/** The Quake window (created by Rust under this label) loads the same page. */
export const QUAKE_LABEL = 'quake';

export function isQuakeWindow(label: string = getCurrentWindow().label): boolean {
  return label === QUAKE_LABEL;
}

/**
 * Quake window: closing its last tab hides it, and a fresh tab is ready for the next
 * time it is summoned.
 */
export function useQuakeTabs(enabled = true): void {
  const empty = useWorkspace((s) => s.tabs.length === 0);
  const hadTabs = useRef(false);
  useEffect(() => {
    if (!enabled) return;
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
