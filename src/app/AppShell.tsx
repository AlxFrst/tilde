import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import type { AppInfo } from '@/ipc/app';
import type { Settings } from '@/ipc/generated/settings';
import { useWorkspace } from '@/stores/workspace';
import { allSessions } from '@/terminal/sessionRegistry';
import { flushWorkspace } from '@/workspace/persistence';
import { confirmClose } from './closeGuard';
import { ConfirmCloseDialog } from './ConfirmCloseDialog';
import { PaneView } from './PaneView';
import { QuickSettingsDialog } from './QuickSettingsDialog';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Titlebar } from './Titlebar';
import { useShortcuts } from './useShortcuts';
import { Welcome } from './Welcome';

/** Asks before closing the window while a program runs in any terminal. */
function useWindowCloseGuard() {
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (await confirmClose(allSessions())) flushWorkspace();
      else event.preventDefault();
    });
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, []);
}

export function AppShell({ settings, appInfo }: { settings: Settings; appInfo: AppInfo }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sidebarPosition, sidebarWidth } = settings.appearance;
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  useShortcuts();
  useWindowCloseGuard();

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
      <Titlebar platform={appInfo.platform} />
      <div className="flex min-h-0 flex-1">
        {sidebarPosition === 'left' && sidebar}
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
        {sidebarPosition === 'right' && sidebar}
      </div>
      <QuickSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmCloseDialog />
    </div>
  );
}
