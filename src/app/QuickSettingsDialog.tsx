import { FileJson, FolderOpen, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatConfigError } from '@/ipc/errors';
import type { Appearance } from '@/ipc/generated/settings';
import { openLogsDir, openSettingsFile } from '@/ipc/settings';
import { useSettings } from '@/stores/settings';
import { builtinThemes, type ThemeKind } from '@/themes';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        // Radix reports '' when the active item is clicked again; keep the current value.
        if (v) onChange(v as T);
      }}
    >
      {options.map(([v, text]) => (
        <ToggleGroupItem key={v} value={v} aria-label={text} className="px-3">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ThemeSelect({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: ThemeKind;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-48" aria-label={`Thème ${kind === 'dark' ? 'sombre' : 'clair'}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {builtinThemes
          .filter((t) => t.kind === kind)
          .map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

const SCHEMES = [
  ['system', 'Système'],
  ['dark', 'Sombre'],
  ['light', 'Clair'],
] as const;
const DENSITIES = [
  ['compact', 'Compacte'],
  ['comfortable', 'Confortable'],
  ['spacious', 'Aérée'],
] as const;
const SIDES = [
  ['left', 'Gauche'],
  ['right', 'Droite'],
] as const;

export function QuickSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, readOnly, error, update } = useSettings();
  if (!settings) return null;
  const a = settings.appearance;
  const set = (patch: Partial<Appearance>) => void update({ appearance: patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Réglages rapides</DialogTitle>
          <DialogDescription>
            Tout est aussi modifiable dans settings.json, rechargé à chaud.
          </DialogDescription>
        </DialogHeader>

        {readOnly && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
            <p>
              {error ? formatConfigError(error) : 'settings.json est invalide.'} Corrigez le
              fichier pour modifier les réglages.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4 py-2">
          <Row label="Apparence">
            <Choice
              label="Apparence"
              value={a.colorScheme}
              options={SCHEMES}
              disabled={readOnly}
              onChange={(colorScheme) => {
                set({ colorScheme });
              }}
            />
          </Row>
          <Row label="Thème sombre">
            <ThemeSelect
              kind="dark"
              value={a.themeDark}
              disabled={readOnly}
              onChange={(themeDark) => {
                set({ themeDark });
              }}
            />
          </Row>
          <Row label="Thème clair">
            <ThemeSelect
              kind="light"
              value={a.themeLight}
              disabled={readOnly}
              onChange={(themeLight) => {
                set({ themeLight });
              }}
            />
          </Row>
          <Row label="Densité">
            <Choice
              label="Densité"
              value={a.density}
              options={DENSITIES}
              disabled={readOnly}
              onChange={(density) => {
                set({ density });
              }}
            />
          </Row>
          <Row label="Barre latérale">
            <Choice
              label="Barre latérale"
              value={a.sidebarPosition}
              options={SIDES}
              disabled={readOnly}
              onChange={(sidebarPosition) => {
                set({ sidebarPosition });
              }}
            />
          </Row>
        </div>

        <div className="flex gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => void openSettingsFile()}>
            <FileJson strokeWidth={1.5} />
            Ouvrir settings.json
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openLogsDir()}>
            <FolderOpen strokeWidth={1.5} />
            Ouvrir le dossier des logs
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
