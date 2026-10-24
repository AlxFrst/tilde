import { Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';

/** The bottom of the Rail: always visible, whatever the list above holds. */
export function RailFooter({
  onOpenSettings,
  children,
}: {
  onOpenSettings: () => void;
  /** The Library and spaces controls. */
  children?: ReactNode;
}) {
  return (
    <div data-rail-footer className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
      {children}
      <button
        type="button"
        aria-label="Réglages"
        onClick={onOpenSettings}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Settings2 className="size-4" strokeWidth={1.5} />
        <span>Réglages</span>
      </button>
    </div>
  );
}
