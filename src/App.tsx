import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { openDefaultTab } from '@/app/actions';
import { AppShell } from '@/app/AppShell';
import { StartupError } from '@/app/StartupError';
import { getAppInfo, type AppInfo } from '@/ipc/app';
import { useProfiles } from '@/stores/profiles';
import { useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useTransfers } from '@/stores/transfers';
import { useWindowEffects } from '@/stores/windowEffects';
import { windowApplyEffects, windowSupportedEffects } from '@/ipc/window';
import { applyTheme } from '@/themes';
import { useActiveTheme } from '@/themes/useActiveTheme';
import { restoreWorkspace, startPersistence } from '@/workspace/persistence';

/** `quake`: the drop-down window (no sidebar, nothing restored or saved). */
export default function App({ mode = 'main' }: { mode?: 'main' | 'quake' }) {
  const quake = mode === 'quake';
  const settings = useSettings((s) => s.settings);
  const init = useSettings((s) => s.init);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const theme = useActiveTheme();
  const density = settings?.appearance.density ?? 'comfortable';
  const uiFontSize = settings?.appearance.uiFontSize ?? 13;
  const effect = settings?.appearance.window.effect ?? 'none';
  const opacity = settings?.appearance.window.opacity ?? 1;

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
        if (quake) {
          openDefaultTab();
          setWorkspaceReady(true);
          return;
        }
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
    let stopKeybindings: (() => void) | undefined;
    useKeybindings
      .getState()
      .init()
      .then(
        (off) => {
          if (isCancelled()) off();
          else stopKeybindings = off;
        },
        (err: unknown) => {
          // The default shortcuts stay active.
          console.warn('keybindings unavailable', err);
        },
      );
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
      stopKeybindings?.();
      stopPersistence?.();
    };
  }, [init, quake]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Window effect (Mica, Acrylic, vibrancy) and translucent backgrounds.
  const dark = theme.kind === 'dark';
  useEffect(() => {
    document.documentElement.style.setProperty('--tilde-bg-alpha', String(opacity));
  }, [opacity]);
  const loaded = settings !== null;
  // Rust reads the effect from the settings; `effect` is listed so a change re-applies it.
  useEffect(() => {
    if (!loaded) return;
    windowApplyEffects(dark).then(
      (applied) => {
        useWindowEffects.setState({ applied });
      },
      (err: unknown) => {
        console.warn('window effect unavailable', err);
      },
    );
  }, [loaded, effect, dark]);
  // Quake shortcut errors (taken by another app, invalid) are reported in the main window.
  useEffect(() => {
    if (quake) return;
    const off = listen<string>('quake://error', (e) => {
      toast.error(e.payload);
    });
    return () => {
      void off.then((f) => {
        f();
      });
    };
  }, [quake]);
  useEffect(() => {
    windowSupportedEffects().then(
      (supported) => {
        useWindowEffects.setState({ supported });
      },
      () => undefined,
    );
  }, []);

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
    // Rust shows the Quake window when its shortcut is pressed.
    if (!canShow || quake) return;
    const timer = setTimeout(() => {
      console.info(`startup: ${Math.round(performance.now())}ms`);
      void getCurrentWindow().show();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [canShow, quake]);

  if (startupError !== null) return <StartupError message={startupError} />;
  if (!ready) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <AppShell settings={settings} appInfo={appInfo} mode={mode} />
      <Toaster theme={theme.kind} position="bottom-right" />
    </TooltipProvider>
  );
}
