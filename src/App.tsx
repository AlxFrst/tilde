import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/app/AppShell';
import { getAppInfo, type AppInfo } from '@/ipc/app';
import { useSettings } from '@/stores/settings';
import { applyTheme, useResolvedTheme } from '@/themes';

const DEFAULT_CHOICE = {
  colorScheme: 'system',
  themeDark: 'tilde-dark',
  themeLight: 'tilde-light',
} as const;

export default function App() {
  const settings = useSettings((s) => s.settings);
  const init = useSettings((s) => s.init);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const theme = useResolvedTheme(settings?.appearance ?? DEFAULT_CHOICE);
  const density = settings?.appearance.density ?? 'comfortable';
  const uiFontSize = settings?.appearance.uiFontSize ?? 13;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void init().then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });
    void getAppInfo().then(setAppInfo);
    return () => {
      cancelled = true;
      unsubscribe?.();
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

  const ready = settings !== null && appInfo !== null;

  // The window starts hidden; show it once the shell has rendered so there is no flash.
  // Not requestAnimationFrame: a hidden WebView2 never runs animation frames.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      console.info(`startup: ${Math.round(performance.now())}ms`);
      void getCurrentWindow().show();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [ready]);

  if (!ready) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <AppShell settings={settings} appInfo={appInfo} />
      <Toaster theme={theme.kind} position="bottom-right" />
    </TooltipProvider>
  );
}
