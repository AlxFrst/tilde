import { useState } from 'react';
import type { AppInfo } from '@/ipc/app';
import type { Settings } from '@/ipc/generated/settings';
import { QuickSettingsDialog } from './QuickSettingsDialog';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Titlebar } from './Titlebar';
import { Welcome } from './Welcome';

export function AppShell({ settings, appInfo }: { settings: Settings; appInfo: AppInfo }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sidebarPosition, sidebarWidth } = settings.appearance;

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
          <div className="min-h-0 flex-1 overflow-auto">
            <Welcome version={appInfo.version} />
          </div>
        </main>
        {sidebarPosition === 'right' && sidebar}
      </div>
      <QuickSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
