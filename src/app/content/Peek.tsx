import { Activity, PanelRight, X } from 'lucide-react';
import { useEffect } from 'react';
import MonitorPane from '@/panels/monitor/MonitorPane';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { findLeaf } from '@/workspace/tree';
import type { MonitorPanel } from '@/workspace/types';
import { paneLabel, useLabelNames } from '../paneLabel';

const noop = () => undefined;

/**
 * The server monitor of a session, over it (Arc's Peek): it does not change the layout.
 * Escape or a click beside it closes it; « Ancrer à droite » makes it a pane.
 */
export function Peek() {
  const peek = useUi((s) => s.peek);
  const tab = useWorkspace((s) =>
    peek
      ? s.tabs.find((t) => t.id === s.activeTabId && findLeaf(t.root, peek.sshLeafId))
      : undefined,
  );
  const names = useLabelNames();
  const close = () => {
    useUi.getState().setPeek(null);
  };

  // The session closed, or another one is shown: the peek goes.
  useEffect(() => {
    if (peek && !tab) useUi.getState().setPeek(null);
  }, [peek, tab]);

  useEffect(() => {
    if (!peek) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useUi.getState().setPeek(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [peek]);

  if (!peek || !tab) return null;
  const ssh = findLeaf(tab.root, peek.sshLeafId);
  const host = ssh ? paneLabel(tab, ssh, names).detail : null;
  const owner =
    ssh?.panel.kind === 'ssh'
      ? (names.connectionName(ssh.panel.connectionId) ?? ssh.panel.target)
      : (host ?? '');
  const state: MonitorPanel = {
    kind: 'monitor',
    source: { kind: 'remote', linkedLeafId: peek.sshLeafId },
    cwd: null,
    title: null,
  };

  return (
    <>
      <div aria-hidden className="absolute inset-0 z-20" onMouseDown={close} />
      <section
        aria-label={`Moniteur · ${owner}`}
        className="absolute top-3 right-3 bottom-3 z-30 flex w-[min(640px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border bg-surface-1 shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <Activity className="size-4 text-primary" strokeWidth={1.75} />
          <span className="text-sm font-medium">Moniteur</span>
          <span className="min-w-0 truncate text-sm text-text-muted">· {owner}</span>
          <span className="flex-1" />
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            onClick={() => {
              useWorkspace.getState().toggleRemoteMonitor(peek.sshLeafId);
              close();
            }}
          >
            <PanelRight className="size-3.5" strokeWidth={1.75} />
            Ancrer à droite
          </button>
          <button
            type="button"
            aria-label="Fermer l’aperçu (Échap)"
            className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            onClick={close}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <MonitorPane
            tabId={tab.id}
            leafId={`peek:${peek.sshLeafId}`}
            state={state}
            active
            visible
            update={noop}
            close={close}
          />
        </div>
      </section>
    </>
  );
}
