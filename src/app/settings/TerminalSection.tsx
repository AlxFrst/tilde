import { msg, t } from '@/i18n';
import { tRust } from '@/i18n/rust';
import type { Settings } from '@/ipc/generated/settings';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { TERMINAL_FONT_SUGGESTIONS } from '@/themes/fonts';
import { Choice, NumberField, Row, Section, SelectField, SwitchField, translated } from './fields';
import { FontField } from './FontField';

const CURSORS = [
  ['block', msg('Bloc')],
  ['bar', msg('Barre')],
  ['underline', msg('Souligné')],
] as const;
const RIGHT_CLICK = [
  ['menu', msg('Menu')],
  ['paste', msg('Coller')],
  ['copyPaste', msg('Copier / coller')],
] as const;
/** Radix Select forbids an empty value; this one stands for « no default profile ». */
const AUTO = '__auto__';

export function TerminalSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  const profiles = useProfiles((s) => s.profiles);
  if (!settings) return null;
  const term = settings.terminal;
  const set = (patch: Partial<Settings['terminal']>) => void update({ terminal: patch });

  return (
    <div className="grid gap-6">
      <Section title={t('Texte')}>
        <FontField
          setting="terminal.fontFamily"
          label={t('Police du terminal')}
          value={term.fontFamily}
          suggestions={TERMINAL_FONT_SUGGESTIONS}
          disabled={readOnly}
          onChange={(fontFamily) => {
            set({ fontFamily });
          }}
        />
        <Row label={t('Taille')}>
          <NumberField
            setting="terminal.fontSize"
            label={t('Taille de police du terminal')}
            value={term.fontSize}
            min={6}
            max={72}
            unit="px"
            disabled={readOnly}
            onChange={(fontSize) => {
              set({ fontSize });
            }}
          />
        </Row>
        <Row label={t('Interligne')}>
          <NumberField
            setting="terminal.lineHeight"
            label={t('Interligne du terminal')}
            value={term.lineHeight}
            min={0.8}
            max={3}
            step={0.1}
            disabled={readOnly}
            onChange={(lineHeight) => {
              set({ lineHeight });
            }}
          />
        </Row>
        <Row
          label={t('Ligatures')}
          hint={t('=> != === … dessinés comme un seul signe (rendu WebGL)')}
        >
          <SwitchField
            setting="terminal.ligatures"
            label={t('Ligatures')}
            checked={term.ligatures}
            disabled={readOnly}
            onChange={(ligatures) => {
              set({ ligatures });
            }}
          />
        </Row>
      </Section>

      <Section title={t('Curseur')}>
        <Row label={t('Forme')}>
          <Choice
            setting="terminal.cursorStyle"
            label={t('Forme du curseur')}
            value={term.cursorStyle}
            options={translated(CURSORS)}
            disabled={readOnly}
            onChange={(cursorStyle) => {
              set({ cursorStyle });
            }}
          />
        </Row>
        <Row label={t('Clignotement')}>
          <SwitchField
            setting="terminal.cursorBlink"
            label={t('Curseur clignotant')}
            checked={term.cursorBlink}
            disabled={readOnly}
            onChange={(cursorBlink) => {
              set({ cursorBlink });
            }}
          />
        </Row>
      </Section>

      <Section title={t('Comportement')}>
        <Row label={t('Profil par défaut')} hint={t('Ouvert par « Nouvel onglet ».')}>
          <SelectField
            setting="terminal.defaultProfile"
            label={t('Profil par défaut')}
            value={term.defaultProfile ?? AUTO}
            options={[
              [AUTO, t('Automatique')],
              ...profiles.map((p) => [p.id, tRust(p.name)] as const),
            ]}
            disabled={readOnly}
            onChange={(v) => {
              set({ defaultProfile: v === AUTO ? null : v });
            }}
          />
        </Row>
        <Row label={t('Historique')} hint={t('Lignes gardées en mémoire par terminal.')}>
          <NumberField
            setting="terminal.scrollback"
            label={t('Taille de l’historique')}
            value={term.scrollback}
            min={0}
            max={1_000_000}
            unit={t('lignes')}
            disabled={readOnly}
            onChange={(scrollback) => {
              set({ scrollback });
            }}
          />
        </Row>
        <Row label={t('Copier à la sélection')}>
          <SwitchField
            setting="terminal.copyOnSelect"
            label={t('Copier à la sélection')}
            checked={term.copyOnSelect}
            disabled={readOnly}
            onChange={(copyOnSelect) => {
              set({ copyOnSelect });
            }}
          />
        </Row>
        <Row label={t('Clic droit')}>
          <Choice
            setting="terminal.rightClick"
            label={t('Clic droit')}
            value={term.rightClick}
            options={translated(RIGHT_CLICK)}
            disabled={readOnly}
            onChange={(rightClick) => {
              set({ rightClick });
            }}
          />
        </Row>
        <Row
          label={t('Confirmer la fermeture')}
          hint={t('Quand un programme tourne encore dans le terminal.')}
        >
          <SwitchField
            setting="terminal.confirmClose"
            label={t('Confirmer la fermeture')}
            checked={term.confirmClose}
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
