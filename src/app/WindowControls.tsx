import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-full w-11 items-center justify-center text-text-muted transition-colors',
        danger ? 'hover:bg-error hover:text-white' : 'hover:bg-surface-2 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/** Minimize / maximize / close for Windows and Linux (macOS keeps native traffic lights). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => {
      void win.isMaximized().then(setMaximized);
    };
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      void unlisten.then((f) => {
        f();
      });
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="flex h-full">
      <ControlButton label={t('Réduire')} onClick={() => void win.minimize()}>
        <Minus className="size-4" strokeWidth={1.5} />
      </ControlButton>
      <ControlButton
        label={maximized ? t('Restaurer') : t('Agrandir')}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.5} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.5} />
        )}
      </ControlButton>
      <ControlButton label={t('Fermer')} danger onClick={() => void win.close()}>
        <X className="size-4" strokeWidth={1.5} />
      </ControlButton>
    </div>
  );
}
