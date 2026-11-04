import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppInfo } from '@/ipc/app';
import type { Settings } from '@/ipc/generated/settings';
import { registerBuiltins } from '@/commands/builtin';
import { useConnections } from '@/stores/connections';
import { useSsh } from '@/stores/ssh';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { shownView, useWorkspace, zoomedLeafOf } from '@/stores/workspace';
import { viewRects } from '@/workspace/view';
import { useAttentionTracking } from './attention';
import { CommandPalette } from './CommandPalette';
import { ConfirmCloseDialog } from './ConfirmCloseDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ConnectionDialog } from './ConnectionDialog';
import { FolderDialog } from './FolderDialog';
import { PaneView } from './PaneView';
import { PromptHost } from './PromptHost';
import { useQuakeTabs } from './quake';
import { QuickConnectDialog } from './QuickConnectDialog';
import { SettingsDialog } from './settings/SettingsDialog';
import { Peek } from './content/Peek';
import { SessionHeader } from './content/SessionHeader';
import { ViewDividers } from './content/ViewDividers';
import { ViewDropOverlay } from './content/ViewDropOverlay';
import { sessionEnv } from './content/sessionEnv';
import { Rail } from './rail/Rail';
import { SpaceDialog } from './spaces/SpaceDialog';
import { LibraryDialog } from './library/LibraryDialog';
import { TabBar } from './TabBar';
import { TunnelsDialog } from './TunnelsDialog';
import { useShortcuts } from './useShortcuts';
import { onCloseRequested } from './windowClose';
import { Welcome } from './Welcome';

/** Asks before closing the window while a program runs in any terminal. */
function useWindowCloseGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const unlisten = getCurrentWindow().onCloseRequested(onCloseRequested);
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, [enabled]);
}

/**
 * The Rail is hidden: by the user, or while the shown session has a pane alone (not when
 * sessions show side by side: the pane fills only its session's slot).
 */
export function useRailHidden(): boolean {
  const hidden = useUi((s) => s.railHidden);
  const zoomed = useWorkspace((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ? zoomedLeafOf(tab, s.zoomed) !== null : false;
  });
  const sideBySide = useWorkspace((s) => shownView(s) !== null);
  return hidden || (zoomed && !sideBySide);
}

/**
 * The Rail while hidden: an edge of the window that brings it back over the content when
 * the mouse reaches it; it slides away 300 ms after the mouse leaves.
 */
function HiddenRail({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  // A row dragged out of the Rail (onto the content) leaves it: the drag belongs to the
  // Rail, so it stays out until the row is dropped.
  const dragging = useUi((s) => s.railDragging);
  const show = () => {
    hovered.current = true;
    clearTimeout(timer.current);
    setShown(true);
  };
  const hideSoon = () => {
    hovered.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!useUi.getState().railDragging) setShown(false);
    }, 300);
  };
  useEffect(() => {
    if (dragging || hovered.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown(false);
    }, 300);
  }, [dragging]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const edge = side === 'left' ? 'left-0' : 'right-0';
  return (
    <>
      <div
        data-rail-edge
        aria-hidden
        className={cn('absolute inset-y-0 z-40 w-2', edge)}
        onMouseEnter={show}
      />
      {shown && (
        <div
          className={cn(
            'absolute inset-y-0 z-40 flex shadow-2xl motion-safe:animate-in motion-safe:fade-in-0',
            side === 'left'
              ? 'left-0 motion-safe:slide-in-from-left-4'
              : 'right-0 motion-safe:slide-in-from-right-4',
          )}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          {children}
        </div>
      )}
    </>
  );
}

export function AppShell({
  settings,
  appInfo,
  mode = 'main',
}: {
  settings: Settings;
  appInfo: AppInfo;
  /** `quake`: no Rail nor header, a tab bar; the window hides (Rust) instead of closing. */
  mode?: 'main' | 'quake';
}) {
  const quake = mode === 'quake';
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const { sidebarPosition, sidebarWidth } = settings.appearance;
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const quickConnectOpen = useSsh((s) => s.quickConnectOpen);
  const railHidden = useRailHidden();
  const activeTab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const file = useConnections((s) => s.file);
  // The sessions shown side by side (never in the Quake console), each in its slot.
  // tabsOnScreen (stores/workspace) says the same, for what the user sees.
  const view = useWorkspace((s) => (quake ? null : shownView(s)));
  const slots = useMemo(() => (view ? viewRects(view) : null), [view]);
  // With a view each slot has its own environment frame; the content area has none.
  const env = activeTab && !slots ? sessionEnv(activeTab, file) : null;
  useShortcuts();
  useEffect(() => registerBuiltins(), []);
  useWindowCloseGuard(!quake);
  useQuakeTabs(quake);
  useAttentionTracking();

  const area = useRef<HTMLElement>(null);
  const isMac = appInfo.platform === 'macos';
  const sidebar = (
    <Rail
      side={sidebarPosition}
      width={sidebarWidth}
      // macOS draws its traffic lights over the top-left corner.
      macInset={isMac && sidebarPosition === 'left'}
      onOpenSettings={() => {
        setSettingsOpen(true);
      }}
    />
  );
  const panes = (
    <>
      {tabs.map((t) => (
        <PaneView
          key={t.id}
          tab={t}
          visible={slots ? slots.has(t.id) : t.id === activeTabId}
          focused={t.id === activeTabId}
          slot={slots?.get(t.id) ?? null}
        />
      ))}
      {(tabs.length === 0 || activeTabId === null) && (
        <div className="absolute inset-0 overflow-auto">
          <Welcome version={appInfo.version} />
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {quake ? (
        <main className="flex min-h-0 flex-1 flex-col">
          <TabBar />
          <div className="relative min-h-0 flex-1">{panes}</div>
        </main>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          {railHidden ? (
            <HiddenRail side={sidebarPosition}>{sidebar}</HiddenRail>
          ) : (
            sidebarPosition === 'left' && sidebar
          )}
          <div
            className="flex min-w-0 flex-1 flex-col"
            style={isMac && sidebarPosition === 'right' ? { paddingLeft: 78 } : undefined}
          >
            <SessionHeader platform={appInfo.platform} />
            <main
              ref={area}
              data-view-area
              className={cn(
                'relative mx-1.5 mb-1.5 min-h-0 flex-1 overflow-hidden rounded-lg border bg-background',
                slots && 'border-transparent bg-transparent',
              )}
              style={
                env
                  ? { borderColor: `color-mix(in srgb, ${env.color} 55%, transparent)` }
                  : undefined
              }
            >
              {panes}
              {view && <ViewDividers view={view} area={area} />}
              <ViewDropOverlay />
              <Peek />
            </main>
          </div>
          {!railHidden && sidebarPosition === 'right' && sidebar}
        </div>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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
      <SpaceDialog />
      <LibraryDialog />
      <PromptHost />
    </div>
  );
}
