import type { Platform } from '@/ipc/app';
import { Logo } from './Logo';
import { WindowControls } from './WindowControls';

/**
 * Custom titlebar. The whole bar is a drag region (double-click toggles maximize);
 * on macOS the native traffic lights sit on top of it, so we leave room on the left.
 */
export function Titlebar({ platform }: { platform: Platform }) {
  const isMac = platform === 'macos';
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-border bg-surface-1"
      style={{ paddingLeft: isMac ? 78 : 12 }}
    >
      <div data-tauri-drag-region className="flex items-center gap-1.5 text-sm font-medium">
        <Logo className="size-5" />
        <span data-tauri-drag-region>Tilde</span>
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      {!isMac && <WindowControls />}
    </header>
  );
}
