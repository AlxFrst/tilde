import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors `ConnState` in crates/tilde-ssh/src/connection.rs. */
export type ConnState =
  | { kind: 'resolving' }
  | { kind: 'connecting'; hop: string }
  | { kind: 'ready' }
  | { kind: 'lost'; reason: string }
  | { kind: 'reconnecting'; attempt: number; inSecs: number }
  | { kind: 'closed' }
  | { kind: 'failed'; message: string };

/** Mirrors `SshHostEntry` in src-tauri/src/commands/ssh.rs. */
export interface SshHostEntry {
  alias: string;
  hostname: string;
  user: string;
  port: number;
}

export interface ChangedKey {
  file: string;
  line: number;
  oldFingerprint: string;
}

/** A question from the connection. Mirrors `PromptEvent` in src-tauri/src/prompter.rs. */
export type SshPrompt = { id: number } & (
  | {
      kind: 'hostKey';
      host: string;
      port: number;
      keyType: string;
      fingerprint: string;
      /** Set when the recorded key differs: possible man-in-the-middle. */
      changed: ChangedKey | null;
    }
  | {
      kind: 'secret';
      secret: 'password' | 'passphrase';
      keyPath: string | null;
      target: string;
      attempt: number;
      canRemember: boolean;
    }
  | {
      kind: 'keyboardInteractive';
      target: string;
      name: string;
      instructions: string;
      questions: { text: string; echo: boolean }[];
    }
);

export type HostKeyChoice = 'acceptAndSave' | 'acceptOnce' | 'replace' | 'reject';

/** Mirrors `PromptReply` in src-tauri/src/prompter.rs. */
export type PromptReply =
  | { kind: 'hostKey'; decision: HostKeyChoice }
  | { kind: 'secret'; value: string; remember: boolean }
  | { kind: 'keyboardInteractive'; answers: string[] }
  | { kind: 'cancel' };

/** Mirrors `ForwardSpec` / `ForwardInfo` in crates/tilde-ssh/src/forward.rs. */
export interface ForwardSpec {
  kind: 'local' | 'remote';
  bind: string;
  /** 0: chosen by the system. */
  listenPort: number;
  host: string;
  port: number;
}

export interface ForwardInfo {
  id: number;
  spec: ForwardSpec;
  boundPort: number;
  activeConnections: number;
  error: string | null;
}

export const sshHosts = () => invoke<SshHostEntry[]>('ssh_hosts');
export const replyPrompt = (id: number, reply: PromptReply) =>
  invoke<boolean>('ssh_prompt_reply', { id, reply });
export const secretsAvailable = () => invoke<boolean>('secrets_available');
export const listForwards = (sessionId: number) =>
  invoke<ForwardInfo[]>('ssh_forwards', { sessionId });
export const addForward = (sessionId: number, spec: ForwardSpec) =>
  invoke<ForwardInfo>('ssh_forward_add', { sessionId, spec });
export const removeForward = (sessionId: number, forwardId: number) =>
  invoke<boolean>('ssh_forward_remove', { sessionId, forwardId });

/** Listens for connection questions (`ssh://prompt`) and for questions that expired. */
export async function onPrompts(
  onAsk: (prompt: SshPrompt) => void,
  onDismiss: (id: number) => void,
): Promise<() => void> {
  const offs = await Promise.all([
    listen<SshPrompt>('ssh://prompt', (e) => {
      onAsk(e.payload);
    }),
    listen<number>('ssh://prompt-dismissed', (e) => {
      onDismiss(e.payload);
    }),
  ]);
  return () => {
    offs.forEach((off) => {
      off();
    });
  };
}

const PART = /^[^\s,@[\]:]+$/;

/** An alias, or `[user@]host[:port]` (`[v6]` hosts too), as `ssh` accepts it. */
export function isValidTarget(text: string): boolean {
  const t = text.trim();
  const at = t.lastIndexOf('@');
  const user = at >= 0 ? t.slice(0, at) : null;
  if (user !== null && !PART.test(user)) return false;
  const rest = at >= 0 ? t.slice(at + 1) : t;
  const m = /^(?:\[([^\]]+)\]|([^\s,@[\]:]+))(?::(\d{1,5}))?$/.exec(rest);
  if (!m) return false;
  const port = m[3];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
}
