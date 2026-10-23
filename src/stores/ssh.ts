import { create } from 'zustand';
import { replyPrompt, type ConnState, type PromptReply, type SshPrompt } from '@/ipc/ssh';

interface SshStore {
  /** Connection state per pane (leaf id); absent for local panes. */
  states: Record<string, ConnState>;
  setState: (leafId: string, state: ConnState) => void;
  clear: (leafId: string) => void;
  /** Questions from the connections, oldest first; the first one is shown. */
  prompts: SshPrompt[];
  ask: (prompt: SshPrompt) => void;
  answer: (id: number, reply: PromptReply) => void;
  /** The backend gave up waiting (timeout): drop the question. */
  dismiss: (id: number) => void;
  quickConnectOpen: boolean;
  setQuickConnectOpen: (open: boolean) => void;
  /** The SSH session whose tunnels are being edited. */
  tunnels: { sessionId: number; title: string } | null;
  setTunnels: (t: { sessionId: number; title: string } | null) => void;
}

export const useSsh = create<SshStore>()((set) => ({
  states: {},
  setState: (leafId, state) => {
    set((s) => ({ states: { ...s.states, [leafId]: state } }));
  },
  clear: (leafId) => {
    set((s) => ({
      states: Object.fromEntries(Object.entries(s.states).filter(([id]) => id !== leafId)),
    }));
  },
  prompts: [],
  ask: (prompt) => {
    set((s) => ({ prompts: [...s.prompts, prompt] }));
  },
  answer: (id, reply) => {
    replyPrompt(id, reply).catch(() => undefined);
    set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
  },
  dismiss: (id) => {
    set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
  },
  quickConnectOpen: false,
  setQuickConnectOpen: (open) => {
    set({ quickConnectOpen: open });
  },
  tunnels: null,
  setTunnels: (tunnels) => {
    set({ tunnels });
  },
}));

export type StatusTone = 'ok' | 'busy' | 'bad';

/** Green when ready, amber while connecting, red when lost or failed. */
export function statusTone(state: ConnState | undefined): StatusTone | null {
  switch (state?.kind) {
    case undefined:
    case 'closed':
      return null;
    case 'ready':
      return 'ok';
    case 'lost':
    case 'failed':
      return 'bad';
    default:
      return 'busy';
  }
}
