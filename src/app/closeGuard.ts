import { create } from 'zustand';
import { isSessionBusy } from '@/ipc/session';
import { useSettings } from '@/stores/settings';

interface CloseGuardState {
  /** Set while the confirmation dialog is shown. */
  pending: { resolve: (ok: boolean) => void } | null;
}

export const useCloseGuard = create<CloseGuardState>()(() => ({ pending: null }));

/**
 * Resolves to true when the panes running `sessionIds` may be closed: immediately if
 * nothing is running in them (or confirmation is disabled), otherwise once the user
 * answers the dialog.
 */
export async function confirmClose(sessionIds: number[]): Promise<boolean> {
  if (!useSettings.getState().settings?.terminal.confirmClose) return true;
  const busy = await Promise.all(sessionIds.map((id) => isSessionBusy(id).catch(() => false)));
  if (!busy.some(Boolean)) return true;
  useCloseGuard.getState().pending?.resolve(false);
  return new Promise((resolve) => {
    useCloseGuard.setState({ pending: { resolve } });
  });
}

export function answerCloseGuard(ok: boolean): void {
  const { pending } = useCloseGuard.getState();
  useCloseGuard.setState({ pending: null });
  pending?.resolve(ok);
}
