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
import { t, tn } from '@/i18n';
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
  return typeof err === 'string' ? err : t('Import impossible');
}

/** Checklist for files holding several schemes (Windows Terminal settings.json). */
function ImportChooser({ result, onDone }: { result: ImportResult; onDone: () => void }) {
  const [checked, setChecked] = useState(() => new Set(result.themes.map((theme) => theme.id)));
  const [busy, setBusy] = useState(false);

  const importSelected = async () => {
    setBusy(true);
    const { save } = useThemes.getState();
    const taken = new Set(allThemes(useThemes.getState().user).map((t) => t.id));
    let saved = 0;
    for (const theme of result.themes) {
      if (!checked.has(theme.id)) continue;
      const id = uniqueThemeId(theme.id, taken);
      taken.add(id);
      if (await save({ ...theme, id })) saved++;
    }
    setBusy(false);
    if (saved > 0) toast.success(tn(saved, '{count} thème importé', '{count} thèmes importés'));
    onDone();
  };

  return (
    <div className="grid gap-3">
      <fieldset aria-label={t('Thèmes à importer')} className="grid gap-1.5">
        {result.themes.map((theme) => (
          <label key={theme.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              aria-label={theme.name}
              checked={checked.has(theme.id)}
              onChange={() => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(theme.id)) next.delete(theme.id);
                  else next.add(theme.id);
                  return next;
                });
              }}
            />
            <Swatches theme={theme} />
            {theme.name}
          </label>
        ))}
      </fieldset>
      {result.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-warning">
          {result.warnings.map((w) => (
            <li key={w}>{t('Ignoré — {warning}', { warning: w })}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('Annuler')}
        </Button>
        <Button disabled={busy || checked.size === 0} onClick={() => void importSelected()}>
          {t('Importer la sélection')}
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
  const userIds = new Set(user.map((theme) => theme.id));

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

  const exportTheme = async (theme: ThemeDefinition) => {
    try {
      if (await themesExport(theme.id, serializeTheme(theme))) toast.success(t('Thème exporté'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (theme: ThemeDefinition) => {
    const ok = await confirmAction({
      title: t('Supprimer « {name} » ?', { name: theme.name }),
      description: t('Le fichier themes/{id}.json sera supprimé.', { id: theme.id }),
      confirmLabel: t('Supprimer'),
      destructive: true,
    });
    if (ok) await useThemes.getState().remove(theme.id);
  };

  const inUse = (theme: ThemeDefinition) =>
    theme.kind === 'dark'
      ? appearance?.themeDark === theme.id
      : appearance?.themeLight === theme.id;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void startImport()}>
          <Upload strokeWidth={1.5} />
          {t('Importer…')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void openThemesDir()}>
          <FolderOpen strokeWidth={1.5} />
          {t('Ouvrir le dossier des thèmes')}
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
              {t('themes/{file} : {message}', { file: e.file, message: e.message })}
            </li>
          ))}
        </ul>
      )}

      <ul className="grid gap-1">
        {allThemes(user).map((theme) => {
          const mine = userIds.has(theme.id);
          const used = inUse(theme);
          const dark = theme.kind === 'dark';
          return (
            <li
              key={theme.id}
              className={cn(
                'flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:bg-surface-2',
                used && 'border-primary/50 bg-primary/10 hover:bg-primary/10',
              )}
            >
              <Swatches theme={theme} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{theme.name}</div>
                <div className="text-xs text-text-muted">
                  {dark ? t('Sombre') : t('Clair')}
                  {mine ? ` · ${t('personnel')}` : ''}
                </div>
              </div>
              {used ? (
                <span className="flex h-6 items-center gap-1 px-2 text-xs font-medium text-primary">
                  <Check className="size-3.5" strokeWidth={2.5} />
                  {dark ? t('Utilisé en sombre') : t('Utilisé en clair')}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={readOnly}
                  onClick={() =>
                    void update({
                      appearance: dark ? { themeDark: theme.id } : { themeLight: theme.id },
                    })
                  }
                >
                  {dark ? t('Utiliser en sombre') : t('Utiliser en clair')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Dupliquer et modifier {name}', { name: theme.name })}
                title={t('Dupliquer et modifier')}
                onClick={() => {
                  setEditing({
                    // The default name of the copy; the user can change it before saving.
                    theme: { ...theme, name: t('{name} (copie)', { name: theme.name }) },
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
                  aria-label={t('Modifier {name}', { name: theme.name })}
                  title={t('Modifier')}
                  onClick={() => {
                    setEditing({ theme, isNew: false });
                  }}
                >
                  <Pencil strokeWidth={1.5} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Exporter {name}', { name: theme.name })}
                title={t('Exporter')}
                onClick={() => void exportTheme(theme)}
              >
                <Download strokeWidth={1.5} />
              </Button>
              {mine && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('Supprimer {name}', { name: theme.name })}
                  title={t('Supprimer')}
                  onClick={() => void remove(theme)}
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
