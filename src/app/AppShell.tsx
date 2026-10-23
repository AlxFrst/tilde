import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import type { AppInfo } from '@/ipc/app';
import type { Settings } from '@/ipc/generated/settings';
import { registerBuiltins } from '@/commands/builtin';
import { useSsh } from '@/stores/ssh';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { allSessions } from '@/terminal/sessionRegistry';
import { flushWorkspace } from '@/workspace/persistence';
import { confirmClose } from './closeGuard';
import { CommandPalette } from './CommandPalette';
import { ConfirmCloseDialog } from './ConfirmCloseDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ConnectionDialog } from './ConnectionDialog';
import { FolderDialog } from './FolderDialog';
import { PaneView } from './PaneView';
import { PromptHost } from './PromptHost';
import { useQuakeTabs } from './quake';
import { QuickConnectDialog } from './QuickConnectDialog';
import { QuickSettingsDialog } from './QuickSettingsDialog';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TunnelsDialog } from './TunnelsDialog';
import { Titlebar } from './Titlebar';
import { useShortcuts } from './useShortcuts';
import { Welcome } from './Welcome';

/** Asks before closing the window while a program runs in any terminal. */
function useWindowCloseGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (await confirmClose(allSessions())) flushWorkspace();
      else event.preventDefault();
    });
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, [enabled]);
}

export function AppShell({
  settings,
  appInfo,
  mode = 'main',
}: {
  settings: Settings;
  appInfo: AppInfo;
  /** `quake`: no titlebar nor sidebar; the window hides (Rust) instead of closing. */
  mode?: 'main' | 'quake';
}) {
  const quake = mode === 'quake';
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const { sidebarPosition, sidebarWidth } = settings.appearance;
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const quickConnectOpen = useSsh((s) => s.quickConnectOpen);
  useShortcuts();
  useEffect(() => registerBuiltins(), []);
  useWindowCloseGuard(!quake);
  useQuakeTabs(quake);

  const sidebar = (
    <Sidebar
      side={sidebarPosition}
      width={sidebarWidth}
      onOpenSettings={() => {
        setSettingsOpen(true);
      }}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {!quake && <Titlebar platform={appInfo.platform} />}
      <div className="flex min-h-0 flex-1">
        {!quake && sidebarPosition === 'left' && sidebar}
        <main className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <div className="relative min-h-0 flex-1">
            {tabs.length === 0 ? (
              <div className="h-full overflow-auto">
                <Welcome version={appInfo.version} />
              </div>
            ) : (
              tabs.map((t) => <PaneView key={t.id} tab={t} visible={t.id === activeTabId} />)
            )}
          </div>
        </main>
        {!quake && sidebarPosition === 'right' && sidebar}
      </div>
      <QuickSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette />
      <ConfirmCloseDialog />
      <ConfirmDialog />
      <ConnectionDialog />
      <FolderDialog />
      <QuickConnectDialog
        open={quickConnectOpen}
        onOpenChange={useSsh.getState().setQuickConnectOpen}
        onConnect={(target) => {
          useWorkspace.getState().openSshTab(target);
        }}
      />
      <TunnelsDialog />
      <PromptHost />
    </div>
  );
}
