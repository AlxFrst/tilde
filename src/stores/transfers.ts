import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { tRust } from '@/i18n/rust';
import { onTransfer, transferReveal, transfersList, type TransferInfo } from '@/ipc/sftp';

interface TransfersState {
  /** By id, in arrival order. */
  transfers: Record<number, TransferInfo>;
  /** Loads the list and follows sftp://transfer; resolves to an unsubscribe function. */
  init: () => Promise<() => void>;
}

/** Events are applied in batches: a folder of 20 000 files must not re-render 40 000 times. */
const FLUSH_MS = 100;

export const isActive = (t: TransferInfo) =>
  t.state.kind === 'queued' || t.state.kind === 'running';

/** The file's name, on whichever side it ends up. */
export function transferName(t: TransferInfo): string {
  const path = t.direction === 'download' ? t.local : t.remote;
  return path.split(/[/\\]/).pop() ?? path;
}

/** Downloads finished since the last « N fichiers téléchargés » toast. */
let finishedDownloads: number[] = [];

/** Toasts for what changed in a batch: failures grouped, downloads once per batch. */
function announce(changes: { previous?: TransferInfo; next: TransferInfo }[], all: TransferInfo[]) {
  const failed: TransferInfo[] = [];
  for (const { previous, next } of changes) {
    if (previous?.state.kind === next.state.kind) continue;
    if (next.state.kind === 'failed') failed.push(next);
    else if (next.state.kind === 'conflict') {
      toast.warning(t('« {name} » a été modifié sur le serveur', { name: transferName(next) }), {
        description: t('Ouvrez les transferts pour choisir la version à garder.'),
      });
    } else if (next.state.kind === 'done' && next.direction === 'download') {
      finishedDownloads.push(next.id);
    }
  }
  const first = failed[0];
  if (first && first.state.kind === 'failed') {
    const title =
      failed.length === 1
        ? t('Échec du transfert « {name} »', { name: transferName(first) })
        : t('{count} transferts ont échoué', { count: failed.length });
    toast.error(title, { description: tRust(first.state.message) });
  }
  // One toast per batch of downloads: when none is still going.
  const last = finishedDownloads.at(-1);
  if (last !== undefined && !all.some((o) => o.direction === 'download' && isActive(o))) {
    const count = finishedDownloads.length;
    const one = all.find((o) => o.id === last);
    finishedDownloads = [];
    toast.success(
      count === 1 && one
        ? t('« {name} » téléchargé', { name: transferName(one) })
        : t('{count} fichiers téléchargés', { count }),
      {
        action: {
          label: t('Ouvrir le dossier'),
          onClick: () => void transferReveal(last).catch(() => undefined),
        },
      },
    );
  }
}

export const useTransfers = create<TransfersState>()((set, get) => ({
  transfers: {},
  init: async () => {
    let pending: TransferInfo[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      const before = get().transfers;
      const transfers = { ...before };
      const changes: { previous?: TransferInfo; next: TransferInfo }[] = [];
      // Only the first previous state and the last next state of each transfer matter.
      const seen = new Map<number, TransferInfo | undefined>();
      for (const t of batch) {
        if (!seen.has(t.id)) seen.set(t.id, before[t.id]);
        transfers[t.id] = t;
      }
      for (const [id, previous] of seen) {
        const next = transfers[id];
        if (next) changes.push({ previous, next });
      }
      set({ transfers });
      announce(changes, Object.values(transfers));
    };
    const off = await onTransfer((t) => {
      pending.push(t);
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    const list = await transfersList().catch(() => []);
    set((s) => ({
      transfers: { ...Object.fromEntries(list.map((t) => [t.id, t])), ...s.transfers },
    }));
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  },
}));
