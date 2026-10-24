import {
  Check,
  Copy,
  Download,
  FolderOpen,
  Pencil,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/app/confirm';
import { Button } from '@/components/ui/button';
import { openThemesDir, themesExport, themesImportPick } from '@/ipc/themes';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { allThemes, serializeTheme, ThemeError, type ThemeDefinition } from '@/themes';
import { importTheme, type ImportResult } from '@/themes/importers';
import { ThemeEditor, uniqueThemeId } from './ThemeEditor';

const SWATCH_KEYS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;

function Swatches({ theme }: { theme: ThemeDefinition }) {
  return (
    <div
      className="flex h-8 w-28 shrink-0 items-center gap-0.5 rounded-md border border-border px-1.5"
      style={{ background: theme.terminal.background.slice(0, 7) }}
      aria-hidden
    >
      <span className="mr-1 size-3 rounded-full" style={{ background: theme.ui.accent }} />
      {SWATCH_KEYS.map((k) => (
        <span key={k} className="size-2.5 rounded-sm" style={{ background: theme.terminal[k] }} />
      ))}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ThemeError) return err.message;
  return typeof err === 'string' ? err : 'Import impossible';
}

/** Checklist for files holding several schemes (Windows Terminal settings.json). */
function ImportChooser({ result, onDone }: { result: ImportResult; onDone: () => void }) {
  const [checked, setChecked] = useState(() => new Set(result.themes.map((t) => t.id)));
  const [busy, setBusy] = useState(false);

  const importSelected = async () => {
    setBusy(true);
    const { save } = useThemes.getState();
    const taken = new Set(allThemes(useThemes.getState().user).map((t) => t.id));
    let saved = 0;
    for (const t of result.themes) {
      if (!checked.has(t.id)) continue;
      const id = uniqueThemeId(t.id, taken);
      taken.add(id);
      if (await save({ ...t, id })) saved++;
    }
    setBusy(false);
    if (saved > 0) toast.success(saved === 1 ? '1 thème importé' : `${saved} thèmes importés`);
    onDone();
  };

  return (
    <div className="grid gap-3">
      <fieldset aria-label="Thèmes à importer" className="grid gap-1.5">
        {result.themes.map((t) => (
          <label key={t.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              aria-label={t.name}
              checked={checked.has(t.id)}
              onChange={() => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                });
              }}
            />
            <Swatches theme={t} />
            {t.name}
          </label>
        ))}
      </fieldset>
      {result.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-warning">
          {result.warnings.map((w) => (
            <li key={w}>Ignoré — {w}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button disabled={busy || checked.size === 0} onClick={() => void importSelected()}>
          Importer la sélection
        </Button>
      </div>
    </div>
  );
}

/** Theme list (builtin and user), editor, import and export. */
export function ThemesSection() {
  const user = useThemes((s) => s.user);
  const errors = useThemes((s) => s.errors);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  const appearance = useSettings((s) => s.settings?.appearance);
  const [editing, setEditing] = useState<{ theme: ThemeDefinition; isNew: boolean } | null>(null);
  const [choosing, setChoosing] = useState<ImportResult | null>(null);
  const userIds = new Set(user.map((t) => t.id));

  if (editing) {
    return (
      <ThemeEditor
        initial={editing.theme}
        isNew={editing.isNew}
        onClose={() => {
          setEditing(null);
        }}
      />
    );
  }
  if (choosing) {
    return (
      <ImportChooser
        result={choosing}
        onDone={() => {
          setChoosing(null);
        }}
      />
    );
  }

  const startImport = async () => {
    try {
      const file = await themesImportPick();
      if (!file) return;
      const result = importTheme(file.name, file.text);
      const [only] = result.themes;
      if (result.themes.length === 1 && only) setEditing({ theme: only, isNew: true });
      else setChoosing(result);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const exportTheme = async (t: ThemeDefinition) => {
    try {
      if (await themesExport(t.id, serializeTheme(t))) toast.success('Thème exporté');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (t: ThemeDefinition) => {
    const ok = await confirmAction({
      title: `Supprimer « ${t.name} » ?`,
      description: `Le fichier themes/${t.id}.json sera supprimé.`,
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (ok) await useThemes.getState().remove(t.id);
  };

  const inUse = (t: ThemeDefinition) =>
    t.kind === 'dark' ? appearance?.themeDark === t.id : appearance?.themeLight === t.id;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void startImport()}>
          <Upload strokeWidth={1.5} />
          Importer…
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openThemesDir()}>
          <FolderOpen strokeWidth={1.5} />
          Ouvrir le dossier des thèmes
        </Button>
        <span className="self-center text-xs text-text-muted">
          iTerm2 (.itermcolors), Windows Terminal (JSON), base16 (YAML)
        </span>
      </div>

      {errors.length > 0 && (
        <ul className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          {errors.map((e) => (
            <li key={`${e.file}:${e.message}`} className="flex gap-2">
              <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.5} />
              themes/{e.file} : {e.message}
            </li>
          ))}
        </ul>
      )}

      <ul className="grid gap-1">
        {allThemes(user).map((t) => {
          const mine = userIds.has(t.id);
          const used = inUse(t);
          const mode = t.kind === 'dark' ? 'sombre' : 'clair';
          return (
            <li
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:bg-surface-2',
                used && 'border-primary/50 bg-primary/10 hover:bg-primary/10',
              )}
            >
              <Swatches theme={t} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{t.name}</div>
                <div className="text-xs text-text-muted">
                  {t.kind === 'dark' ? 'Sombre' : 'Clair'}
                  {mine ? ' · personnel' : ''}
                </div>
              </div>
              {used ? (
                <span className="flex h-6 items-center gap-1 px-2 text-xs font-medium text-primary">
                  <Check className="size-3.5" strokeWidth={2.5} />
                  Utilisé en {mode}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={readOnly}
                  onClick={() =>
                    void update({
                      appearance: t.kind === 'dark' ? { themeDark: t.id } : { themeLight: t.id },
                    })
                  }
                >
                  Utiliser en {mode}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Dupliquer et modifier ${t.name}`}
                title="Dupliquer et modifier"
                onClick={() => {
                  setEditing({
                    theme: { ...t, name: `${t.name} (copie)` },
                    isNew: true,
                  });
                }}
              >
                <Copy strokeWidth={1.5} />
              </Button>
              {mine && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Modifier ${t.name}`}
                  title="Modifier"
                  onClick={() => {
                    setEditing({ theme: t, isNew: false });
                  }}
                >
                  <Pencil strokeWidth={1.5} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Exporter ${t.name}`}
                title="Exporter"
                onClick={() => void exportTheme(t)}
              >
                <Download strokeWidth={1.5} />
              </Button>
              {mine && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Supprimer ${t.name}`}
                  title="Supprimer"
                  onClick={() => void remove(t)}
                >
                  <Trash2 strokeWidth={1.5} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
