import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/app/AppShell';
import { StartupError } from '@/app/StartupError';
import { getAppInfo, type AppInfo } from '@/ipc/app';
import { useProfiles } from '@/stores/profiles';
import { useConnections } from '@/stores/connections';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useTransfers } from '@/stores/transfers';
import { applyTheme } from '@/themes';
import { useActiveTheme } from '@/themes/useActiveTheme';
import { restoreWorkspace, startPersistence } from '@/workspace/persistence';

export default function App() {
  const settings = useSettings((s) => s.settings);
  const init = useSettings((s) => s.init);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const theme = useActiveTheme();
  const density = settings?.appearance.density ?? 'comfortable';
  const uiFontSize = settings?.appearance.uiFontSize ?? 13;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let stopPersistence: (() => void) | undefined;
    const run = { cancelled: false };
    // Read through a function: the cleanup flips the flag while awaits are pending.
    const isCancelled = () => run.cancelled;
    const fail = (err: unknown) => {
      console.error('startup failed', err);
      if (!isCancelled()) setStartupError(err instanceof Error ? err.message : String(err));
    };
    const profiles = useProfiles
      .getState()
      .load()
      .catch((err: unknown) => {
        console.warn('shell detection failed', err);
      });
    init()
      .then(async (off) => {
        if (isCancelled()) {
          off();
          return;
        }
        unsubscribe = off;
        await profiles;
        const loaded = useSettings.getState().settings;
        // In StrictMode the first run is cancelled before this point: restore only once.
        if (isCancelled() || !loaded) return;
        await restoreWorkspace(useProfiles.getState().profiles, loaded);
        if (isCancelled()) return;
        stopPersistence = startPersistence();
        setWorkspaceReady(true);
      })
      .catch(fail);
    getAppInfo().then(setAppInfo, fail);
    let stopConnections: (() => void) | undefined;
    let stopTransfers: (() => void) | undefined;
    let stopThemes: (() => void) | undefined;
    useThemes
      .getState()
      .init()
      .then(
        (off) => {
          if (isCancelled()) off();
          else stopThemes = off;
        },
        (err: unknown) => {
          // Builtin themes still work.
          console.warn('user themes unavailable', err);
        },
      );
    useTransfers
      .getState()
      .init()
      .then(
        (off) => {
          if (isCancelled()) off();
          else stopTransfers = off;
        },
        (err: unknown) => {
          console.warn('transfers unavailable', err);
        },
      );
    useConnections
      .getState()
      .init()
      .then(
        (off) => {
          if (isCancelled()) off();
          else stopConnections = off;
        },
        (err: unknown) => {
          // The sidebar shows an empty list; the rest of the app works without it.
          console.warn('connections unavailable', err);
        },
      );
    return () => {
      run.cancelled = true;
      unsubscribe?.();
      stopConnections?.();
      stopTransfers?.();
      stopThemes?.();
      stopPersistence?.();
    };
  }, [init]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Everything is rem-based, so the root font size scales the whole UI.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = density;
    root.style.setProperty('--tilde-ui-font-size', `${uiFontSize}px`);
  }, [density, uiFontSize]);

  const ready = settings !== null && appInfo !== null && workspaceReady;
  const canShow = ready || startupError !== null;

  // The window starts hidden; show it once the shell (or the error screen) has rendered
  // so there is no flash. Not requestAnimationFrame: a hidden WebView2 never runs frames.
  useEffect(() => {
    if (!canShow) return;
    const timer = setTimeout(() => {
      console.info(`startup: ${Math.round(performance.now())}ms`);
      void getCurrentWindow().show();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [canShow]);

  if (startupError !== null) return <StartupError message={startupError} />;
  if (!ready) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <AppShell settings={settings} appInfo={appInfo} />
      <Toaster theme={theme.kind} position="bottom-right" />
    </TooltipProvider>
  );
}
