import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  /** Red confirm button (deleting…). */
  destructive?: boolean;
}

interface ConfirmState {
  pending: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirm = create<ConfirmState>()(() => ({ pending: null }));

/** Asks the user (ConfirmDialog); resolves to their answer. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  useConfirm.getState().pending?.resolve(false);
  return new Promise((resolve) => {
    useConfirm.setState({ pending: { ...request, resolve } });
  });
}

export function answerConfirm(ok: boolean): void {
  const { pending } = useConfirm.getState();
  useConfirm.setState({ pending: null });
  pending?.resolve(ok);
}
