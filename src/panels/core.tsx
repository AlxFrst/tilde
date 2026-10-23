// Tilde's own panes, registered through the same path plugins will use.

import { FolderTree, Server, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { SftpPanelView } from '@/panels/sftp/SftpPanel';
import { TerminalView } from '@/terminal/TerminalView';
import type { SftpPanel, SshPanel, TerminalPanel } from '@/workspace/types';
import { editorModule } from './editor/module';
import { monitorModule } from './monitor/module';
import { previewModule } from './preview/module';
import { registerPanel, type PanelProps } from './registry';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function TerminalPane({
  tabId,
  leafId,
  state,
  active,
  update,
  close,
}: PanelProps<TerminalPanel> | PanelProps<SshPanel>) {
  return (
    <TerminalView
      tabId={tabId}
      leafId={leafId}
      panel={state}
      active={active}
      onExit={(code) => {
        // A clean exit closes the pane; otherwise the overlay shows the code.
        if (code === 0) close();
      }}
      onTitle={(title) => {
        update({ title });
      }}
      onCwd={(cwd) => {
        update({ cwd });
      }}
      onSessionError={(err) => {
        toast.error(err.message);
      }}
      onClose={close}
    />
  );
}

function SftpPane({ tabId, leafId, state, active }: PanelProps<SftpPanel>) {
  return <SftpPanelView tabId={tabId} leafId={leafId} panel={state} active={active} />;
}

let registered = false;

/** Registers the built-in panes (once). */
export function registerCorePanels(): void {
  if (registered) return;
  registered = true;

  registerPanel<TerminalPanel>({
    id: 'core.terminal',
    kind: 'terminal',
    title: 'Terminal',
    icon: SquareTerminal,
    component: TerminalPane,
    deserialize: (raw) => {
      const profileId = str(raw.profileId);
      if (!profileId) return null;
      return { kind: 'terminal', profileId, cwd: str(raw.cwd), title: str(raw.title) };
    },
  });

  registerPanel<SshPanel>({
    id: 'core.ssh',
    kind: 'ssh',
    title: 'SSH',
    icon: Server,
    component: TerminalPane,
    deserialize: (raw) => {
      const target = str(raw.target)?.trim();
      if (!target) return null;
      const connectionId = str(raw.connectionId);
      return { kind: 'ssh', target, connectionId, cwd: str(raw.cwd), title: str(raw.title) };
    },
  });

  registerPanel<SftpPanel>({
    id: 'core.sftp',
    kind: 'sftp',
    title: 'Fichiers',
    icon: FolderTree,
    component: SftpPane,
    deserialize: (raw) => {
      const linkedLeafId = str(raw.linkedLeafId);
      if (!linkedLeafId) return null;
      const follow = typeof raw.follow === 'boolean' ? raw.follow : true;
      return { kind: 'sftp', linkedLeafId, path: str(raw.path), follow, cwd: null, title: null };
    },
  });

  registerPanel(editorModule);
  registerPanel(previewModule);
  registerPanel(monitorModule);
}
