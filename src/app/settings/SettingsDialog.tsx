import {
  Cable,
  FolderSync,
  Keyboard,
  Paintbrush,
  Palette,
  Settings2,
  SquareTerminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatConfigError } from '@/ipc/errors';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { useUi, type SettingsSectionId } from '@/stores/ui';
import { AppearanceSection } from './AppearanceSection';
import { GeneralSection } from './GeneralSection';
import { SftpSection } from './SftpSection';
import { ShortcutsSection } from './ShortcutsSection';
import { SshSection } from './SshSection';
import { TerminalSection } from './TerminalSection';
import { ThemesSection } from './ThemesSection';

const SECTIONS: [SettingsSectionId, string, LucideIcon, ComponentType][] = [
  ['appearance', 'Apparence', Paintbrush, AppearanceSection],
  ['themes', 'Thèmes', Palette, ThemesSection],
  ['terminal', 'Terminal', SquareTerminal, TerminalSection],
  ['shortcuts', 'Raccourcis', Keyboard, ShortcutsSection],
  ['ssh', 'SSH', Cable, SshSection],
  ['sftp', 'SFTP', FolderSync, SftpSection],
  ['general', 'Général', Settings2, GeneralSection],
];

/** Every setting, by section. Everything is also editable in the JSON files. */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const section = useUi((s) => s.settingsSection);
  const setSection = useUi((s) => s.setSettingsSection);
  const readOnly = useSettings((s) => s.readOnly);
  const error = useSettings((s) => s.error);
  const [, title, , Body] = SECTIONS.find(([id]) => id === section) ?? SECTIONS[0] ?? [];
  if (!title || !Body) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[720px] flex-row gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <nav
          aria-label="Sections des réglages"
          className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-surface-1 p-2"
        >
          <DialogTitle className="px-2 pt-1 pb-3">Réglages</DialogTitle>
          {SECTIONS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-current={id === section ? 'page' : undefined}
              onClick={() => {
                setSection(id);
              }}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2',
                id === section && 'bg-surface-2 text-text',
                id !== section && 'text-text-muted',
              )}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b px-6 py-4">
            <h2 className="text-base font-medium">{title}</h2>
            <DialogDescription>
              Tout est aussi modifiable dans les fichiers de réglages, rechargés à chaud.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {readOnly && (
              <div
                role="alert"
                className="mb-4 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <p>
                  {error ? formatConfigError(error) : 'settings.json est invalide.'} Corrigez le
                  fichier pour modifier les réglages.
                </p>
              </div>
            )}
            <Body />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
