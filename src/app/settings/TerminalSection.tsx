import type { Settings } from '@/ipc/generated/settings';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { TERMINAL_FONT_SUGGESTIONS } from '@/themes/fonts';
import { Choice, NumberField, Row, Section, SelectField, SwitchField } from './fields';
import { FontField } from './FontField';

const CURSORS = [
  ['block', 'Bloc'],
  ['bar', 'Barre'],
  ['underline', 'Souligné'],
] as const;
const RIGHT_CLICK = [
  ['menu', 'Menu'],
  ['paste', 'Coller'],
  ['copyPaste', 'Copier / coller'],
] as const;
/** Radix Select forbids an empty value; this one stands for « no default profile ». */
const AUTO = '__auto__';

export function TerminalSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  const profiles = useProfiles((s) => s.profiles);
  if (!settings) return null;
  const t = settings.terminal;
  const set = (patch: Partial<Settings['terminal']>) => void update({ terminal: patch });

  return (
    <div className="grid gap-6">
      <Section title="Texte">
        <FontField
          setting="terminal.fontFamily"
          label="Police du terminal"
          value={t.fontFamily}
          suggestions={TERMINAL_FONT_SUGGESTIONS}
          disabled={readOnly}
          onChange={(fontFamily) => {
            set({ fontFamily });
          }}
        />
        <Row label="Taille">
          <NumberField
            setting="terminal.fontSize"
            label="Taille de police du terminal"
            value={t.fontSize}
            min={6}
            max={72}
            unit="px"
            disabled={readOnly}
            onChange={(fontSize) => {
              set({ fontSize });
            }}
          />
        </Row>
        <Row label="Interligne">
          <NumberField
            setting="terminal.lineHeight"
            label="Interligne du terminal"
            value={t.lineHeight}
            min={0.8}
            max={3}
            step={0.1}
            disabled={readOnly}
            onChange={(lineHeight) => {
              set({ lineHeight });
            }}
          />
        </Row>
        <Row label="Ligatures" hint="=> != === … dessinés comme un seul signe (rendu WebGL)">
          <SwitchField
            setting="terminal.ligatures"
            label="Ligatures"
            checked={t.ligatures}
            disabled={readOnly}
            onChange={(ligatures) => {
              set({ ligatures });
            }}
          />
        </Row>
      </Section>

      <Section title="Curseur">
        <Row label="Forme">
          <Choice
            setting="terminal.cursorStyle"
            label="Forme du curseur"
            value={t.cursorStyle}
            options={CURSORS}
            disabled={readOnly}
            onChange={(cursorStyle) => {
              set({ cursorStyle });
            }}
          />
        </Row>
        <Row label="Clignotement">
          <SwitchField
            setting="terminal.cursorBlink"
            label="Curseur clignotant"
            checked={t.cursorBlink}
            disabled={readOnly}
            onChange={(cursorBlink) => {
              set({ cursorBlink });
            }}
          />
        </Row>
      </Section>

      <Section title="Comportement">
        <Row label="Profil par défaut" hint="Ouvert par « Nouvel onglet ».">
          <SelectField
            setting="terminal.defaultProfile"
            label="Profil par défaut"
            value={t.defaultProfile ?? AUTO}
            options={[[AUTO, 'Automatique'], ...profiles.map((p) => [p.id, p.name] as const)]}
            disabled={readOnly}
            onChange={(v) => {
              set({ defaultProfile: v === AUTO ? null : v });
            }}
          />
        </Row>
        <Row label="Historique" hint="Lignes gardées en mémoire par terminal.">
          <NumberField
            setting="terminal.scrollback"
            label="Taille de l’historique"
            value={t.scrollback}
            min={0}
            max={1_000_000}
            unit="lignes"
            disabled={readOnly}
            onChange={(scrollback) => {
              set({ scrollback });
            }}
          />
        </Row>
        <Row label="Copier à la sélection">
          <SwitchField
            setting="terminal.copyOnSelect"
            label="Copier à la sélection"
            checked={t.copyOnSelect}
            disabled={readOnly}
            onChange={(copyOnSelect) => {
              set({ copyOnSelect });
            }}
          />
        </Row>
        <Row label="Clic droit">
          <Choice
            setting="terminal.rightClick"
            label="Clic droit"
            value={t.rightClick}
            options={RIGHT_CLICK}
            disabled={readOnly}
            onChange={(rightClick) => {
              set({ rightClick });
            }}
          />
        </Row>
        <Row
          label="Confirmer la fermeture"
          hint="Quand un programme tourne encore dans le terminal."
        >
          <SwitchField
            setting="terminal.confirmClose"
            label="Confirmer la fermeture"
            checked={t.confirmClose}
            disabled={readOnly}
            onChange={(confirmClose) => {
              set({ confirmClose });
            }}
          />
        </Row>
      </Section>
    </div>
  );
}
