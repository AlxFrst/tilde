import { TriangleAlert, Wand2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useThemes } from '@/stores/themes';
import {
  allThemes,
  contrastRatio,
  deriveUiTokens,
  type TerminalColors,
  type ThemeDefinition,
  type ThemeKind,
  type UiTokens,
} from '@/themes';
import { slugify } from '@/themes/importers';
import { ColorField } from './ColorField';

const UI_LABELS: [keyof UiTokens, string][] = [
  ['bg', 'Fond'],
  ['surface1', 'Surface 1'],
  ['surface2', 'Surface 2'],
  ['border', 'Bordure'],
  ['text', 'Texte'],
  ['textMuted', 'Texte secondaire'],
  ['accent', 'Accent'],
  ['accent2', 'Accent secondaire'],
  ['success', 'Succès'],
  ['warning', 'Avertissement'],
  ['error', 'Erreur'],
];

const TERMINAL_LABELS: [keyof TerminalColors, string][] = [
  ['foreground', 'Texte du terminal'],
  ['background', 'Fond du terminal'],
  ['cursor', 'Curseur'],
  ['cursorAccent', 'Texte sous le curseur'],
  ['selectionBackground', 'Sélection'],
];

const ANSI_NAMES = ['Noir', 'Rouge', 'Vert', 'Jaune', 'Bleu', 'Magenta', 'Cyan', 'Blanc'];
const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const satisfies readonly (keyof TerminalColors)[];
const BRIGHT_KEYS = [
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies readonly (keyof TerminalColors)[];

/** `base`, or `base-2`, `base-3`… if taken. */
export function uniqueThemeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(id)) return id;
  }
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    // `min-w-0`: a fieldset otherwise refuses to shrink below its widest row and spills
    // into the next column; `content-start`: rows keep their height in a taller column.
    <fieldset className="grid min-w-0 content-start gap-1.5">
      <legend className="mb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Contrast({ theme }: { theme: ThemeDefinition }) {
  const checks: [string, number, number][] = [
    ['Texte / fond', contrastRatio(theme.ui.text, theme.ui.bg), 4.5],
    ['Texte secondaire / fond', contrastRatio(theme.ui.textMuted, theme.ui.bg), 3],
    [
      'Terminal',
      contrastRatio(theme.terminal.foreground, theme.terminal.background.slice(0, 7)),
      4.5,
    ],
  ];
  const failing = checks.filter(([, ratio, min]) => ratio < min);
  return (
    <div className="grid gap-2">
      <ul className="grid grid-cols-3 gap-2 text-xs">
        {checks.map(([label, ratio, min]) => (
          <li key={label} className="rounded-md border border-border px-2 py-1">
            <span className="text-text-muted">{label}</span>{' '}
            <span className={ratio < min ? 'text-warning' : 'text-success'}>
              {ratio.toFixed(1)}:1
            </span>
          </li>
        ))}
      </ul>
      {failing.length > 0 && (
        <p role="alert" className="flex items-center gap-2 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.5} />
          Contraste insuffisant ({failing.map(([l]) => l).join(', ')}) : le texte sera difficile à
          lire.
        </p>
      )}
    </div>
  );
}

/**
 * Edits a theme with a live preview: every change is shown on the whole window until
 * the editor closes (saved or cancelled).
 */
export function ThemeEditor({
  initial,
  isNew,
  onClose,
}: {
  initial: ThemeDefinition;
  /** A copy or an import: saved under a new id. */
  isNew: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const setPreview = useThemes((s) => s.setPreview);

  useEffect(() => {
    setPreview(draft);
  }, [draft, setPreview]);
  // Closing the settings while editing must not leave the preview on.
  useEffect(
    () => () => {
      setPreview(null);
    },
    [setPreview],
  );

  const setUi = (key: keyof UiTokens, value: string) => {
    setDraft((d) => ({ ...d, ui: { ...d.ui, [key]: value } }));
  };
  const setTerminal = (key: keyof TerminalColors, value: string) => {
    setDraft((d) => ({ ...d, terminal: { ...d.terminal, [key]: value } }));
  };
  const name = draft.name.trim();

  const cancel = () => {
    setPreview(null);
    onClose();
  };

  const save = async () => {
    const { user, save: write } = useThemes.getState();
    let id = draft.id;
    if (isNew) {
      const taken = new Set(allThemes(user).map((t) => t.id));
      id = uniqueThemeId(slugify(name), taken);
    }
    setSaving(true);
    const ok = await write({ ...draft, id, name });
    setSaving(false);
    if (!ok) return;
    toast.success(`Thème « ${name} » enregistré`);
    setPreview(null);
    onClose();
  };

  return (
    <form
      className="@container grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid flex-1 gap-1 text-sm">
          Nom
          <Input
            aria-label="Nom du thème"
            maxLength={80}
            value={draft.name}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setDraft((d) => ({ ...d, name: value }));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Type
          <select
            aria-label="Type de thème"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={draft.kind}
            onChange={(e) => {
              const kind = e.currentTarget.value as ThemeKind;
              setDraft((d) => ({ ...d, kind }));
            }}
          >
            <option value="dark">Sombre</option>
            <option value="light">Clair</option>
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft((d) => ({ ...d, ui: deriveUiTokens(d.terminal) }));
          }}
        >
          <Wand2 strokeWidth={1.5} />
          Dériver l’interface du terminal
        </Button>
      </div>

      <Contrast theme={draft} />

      {/* Two columns when the pane is wide enough (not the window: the settings dialog is
          narrower than the screen). */}
      <div className="grid gap-6 @xl:grid-cols-2">
        <div className="grid content-start gap-6">
          <Group title="Interface">
            {UI_LABELS.map(([key, label]) => (
              <ColorField
                key={key}
                label={label}
                value={draft.ui[key]}
                onChange={(v) => {
                  setUi(key, v);
                }}
              />
            ))}
          </Group>
          <Group title="Terminal">
            {TERMINAL_LABELS.map(([key, label]) => (
              <ColorField
                key={key}
                label={label}
                alpha={key === 'selectionBackground'}
                value={draft.terminal[key]}
                onChange={(v) => {
                  setTerminal(key, v);
                }}
              />
            ))}
          </Group>
        </div>
        <Group title="Couleurs ANSI">
          {ANSI_KEYS.map((key, i) => (
            <ColorField
              key={key}
              label={ANSI_NAMES[i] ?? key}
              value={draft.terminal[key]}
              onChange={(v) => {
                setTerminal(key, v);
              }}
            />
          ))}
          {BRIGHT_KEYS.map((key, i) => (
            <ColorField
              key={key}
              label={`${ANSI_NAMES[i] ?? key} vif`}
              value={draft.terminal[key]}
              onChange={(v) => {
                setTerminal(key, v);
              }}
            />
          ))}
        </Group>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={cancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={!name || saving}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
