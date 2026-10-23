import { FileJson, FolderOpen, Palette, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { openKeybindingsFile } from '@/ipc/keybindings';
import { openLogsDir, openSettingsFile } from '@/ipc/settings';
import { openThemesDir } from '@/ipc/themes';
import { quakeStatus } from '@/ipc/window';
import { checkForUpdates } from '@/app/updates';
import { useSettings } from '@/stores/settings';
import { bindingKeys } from '@/terminal/keyLabels';
import type { Binding } from '@/terminal/keys';
import { Row, Section, SwitchField } from './fields';
import { ShortcutRecorder } from './ShortcutRecorder';

/**
 * A global shortcut is registered by virtual key, and symbol keys move with the layout
 * (on AZERTY the « ` » virtual key is ù): only letters, digits and named keys are safe.
 */
function globalKeyProblem(b: Binding): string | null {
  return /^([A-Z0-9]|F\d+|Arrow\w+|Tab|Enter|Escape|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/.test(
    b.key,
  )
    ? null
    : 'Pour un raccourci global, choisissez une lettre, un chiffre ou une touche F : un symbole change de place selon la disposition du clavier.';
}

export function GeneralSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  const [recording, setRecording] = useState(false);
  const [quakeError, setQuakeError] = useState<string | null>(null);
  const quakeEnabled = settings?.general.quake.enabled;
  const quakeShortcut = settings?.general.quake.shortcut;
  // Rust re-registers the shortcut when these change; ask how it went.
  useEffect(() => {
    let cancelled = false;
    quakeStatus().then(
      (status) => {
        if (!cancelled) setQuakeError(status);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [quakeEnabled, quakeShortcut]);
  if (!settings) return null;
  const g = settings.general;

  return (
    <div className="grid gap-6">
      <Section title="Démarrage">
        <Row
          label="Restaurer la session"
          hint="Onglets et panneaux rouverts au lancement ; les onglets SSH attendent Entrée."
        >
          <SwitchField
            setting="general.restoreSession"
            label="Restaurer la session"
            checked={g.restoreSession}
            disabled={readOnly}
            onChange={(restoreSession) => void update({ general: { restoreSession } })}
          />
        </Row>
        <Row
          label="« Ouvrir dans Tilde » dans l’Explorateur"
          hint="Windows : clic droit sur un dossier ou dans un dossier ouvre un terminal à cet endroit (sous Windows 11, dans « Afficher plus d’options »)."
        >
          <SwitchField
            setting="general.explorerMenu"
            label="« Ouvrir dans Tilde » dans l’Explorateur"
            checked={g.explorerMenu}
            disabled={readOnly}
            onChange={(explorerMenu) => void update({ general: { explorerMenu } })}
          />
        </Row>
      </Section>

      <Section title="Mises à jour">
        <Row
          label="Rechercher au démarrage"
          hint="Une requête vers GitHub au plus une fois par jour ; rien d’autre n’est envoyé."
        >
          <SwitchField
            setting="general.checkUpdates"
            label="Rechercher les mises à jour au démarrage"
            checked={g.checkUpdates}
            disabled={readOnly}
            onChange={(checkUpdates) => void update({ general: { checkUpdates } })}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => void checkForUpdates({ manual: true })}
          >
            Rechercher maintenant
          </Button>
        </Row>
      </Section>

      <Section title="Mode Quake">
        <Row
          label="Terminal déroulant"
          hint="Un raccourci global affiche ou masque un terminal en haut de l’écran."
        >
          <SwitchField
            setting="general.quake.enabled"
            label="Mode Quake"
            checked={g.quake.enabled}
            disabled={readOnly}
            onChange={(enabled) => void update({ general: { quake: { enabled } } })}
          />
        </Row>
        {quakeError && (
          <p role="status" className="text-xs text-warning">
            {quakeError}
          </p>
        )}
        <Row label="Raccourci global">
          {recording ? (
            <ShortcutRecorder
              label="Nouveau raccourci Quake"
              onRecord={(shortcut) => {
                setRecording(false);
                void update({ general: { quake: { shortcut } } });
              }}
              onCancel={() => {
                setRecording(false);
              }}
              validate={globalKeyProblem}
            />
          ) : (
            <>
              <span className="flex gap-1">
                {bindingKeys(g.quake.shortcut).map((k) => (
                  <kbd key={k} className="rounded border bg-surface-2 px-1.5 font-mono text-xs">
                    {k}
                  </kbd>
                ))}
              </span>
              <Button
                variant="ghost"
                size="xs"
                data-setting="general.quake.shortcut"
                aria-label="Modifier le raccourci Quake"
                disabled={readOnly}
                onClick={() => {
                  setRecording(true);
                }}
              >
                Modifier
              </Button>
            </>
          )}
        </Row>
      </Section>

      <Section title="Fichiers">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void openSettingsFile()}>
            <FileJson strokeWidth={1.5} />
            settings.json
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openKeybindingsFile()}>
            <FileJson strokeWidth={1.5} />
            keybindings.json
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openThemesDir()}>
            <Palette strokeWidth={1.5} />
            Dossier des thèmes
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openLogsDir()}>
            <ScrollText strokeWidth={1.5} />
            Logs
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <FolderOpen className="size-3.5" strokeWidth={1.5} />
          Les fichiers sont rechargés à chaud : une modification s’applique sans redémarrer.
        </p>
      </Section>
    </div>
  );
}
