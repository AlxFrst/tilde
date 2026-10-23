import { toast } from 'sonner';
import { create } from 'zustand';
import { onTransfer, transferReveal, transfersList, type TransferInfo } from '@/ipc/sftp';

interface TransfersState {
  /** By id, in arrival order. */
  transfers: Record<number, TransferInfo>;
  /** Loads the list and follows sftp://transfer; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
}

export const isActive = (t: TransferInfo) =>
  t.state.kind === 'queued' || t.state.kind === 'running';

/** The file's name, on whichever side it ends up. */
export function transferName(t: TransferInfo): string {
  const path = t.direction === 'download' ? t.local : t.remote;
  return path.split(/[/\\]/).pop() ?? path;
}

/** Downloads finished since the last « N fichiers téléchargés » toast. */
let finishedDownloads: number[] = [];

function announce(previous: TransferInfo | undefined, t: TransferInfo, all: TransferInfo[]): void {
  if (previous?.state.kind === t.state.kind) return;
  const name = transferName(t);
  if (t.state.kind === 'failed') {
    toast.error(`Échec du transfert « ${name} »`, { description: t.state.message });
  } else if (t.state.kind === 'conflict') {
    toast.warning(`« ${name} » a été modifié sur le serveur`, {
      description: 'Ouvrez les transferts pour choisir la version à garder.',
    });
  } else if (t.state.kind === 'done' && t.direction === 'download') {
    finishedDownloads.push(t.id);
    // One toast per batch: when no other download is still going.
    if (!all.some((o) => o.direction === 'download' && isActive(o))) {
      const count = finishedDownloads.length;
      const last = t.id;
      finishedDownloads = [];
      toast.success(
        count === 1 ? `« ${name} » téléchargé` : `${String(count)} fichiers téléchargés`,
        {
          action: {
            label: 'Ouvrir le dossier',
            onClick: () => void transferReveal(last).catch(() => undefined),
          },
        },
      );
    }
  }
}

export const useTransfers = create<TransfersState>()((set, get) => ({
  transfers: {},
  init: async () => {
    const off = await onTransfer((t) => {
      const previous = get().transfers[t.id];
      const transfers = { ...get().transfers, [t.id]: t };
      set({ transfers });
      announce(previous, t, Object.values(transfers));
    });
    const list = await transfersList().catch(() => []);
    set((s) => ({
      transfers: { ...Object.fromEntries(list.map((t) => [t.id, t])), ...s.transfers },
    }));
    return off;
  },
}));
