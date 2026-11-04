import { useEffect } from 'react';
import { onWindowFocus, windowHasFocus } from '@/ipc/notify';
import { useAttention, watchAttention } from '@/stores/attention';

/**
 * Follows this window's focus, which tells whether a session on screen is seen, and
 * clears a session's mark in the Rail once the user sees it.
 */
export function useAttentionTracking(): void {
  useEffect(() => {
    const { setWindowFocused } = useAttention.getState();
    setWindowFocused(windowHasFocus());
    const offFocus = onWindowFocus(setWindowFocused);
    const offWatch = watchAttention();
    return () => {
      offFocus();
      offWatch();
    };
  }, []);
}
