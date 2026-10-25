import { msg, t } from '@/i18n';
import { useSettings } from '@/stores/settings';
import { Choice, NumberField, Row, Section, TextField, translated } from './fields';

const EDITOR_MODES = [
  ['external', msg('Éditeur externe')],
  ['builtin', msg('Éditeur intégré')],
] as const;

export function SftpSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  if (!settings) return null;
  const s = settings.sftp;

  return (
    <div className="grid gap-6">
      <Section title={t('Transferts')}>
        <Row label={t('Transferts simultanés')}>
          <NumberField
            setting="sftp.concurrency"
            label={t('Transferts simultanés')}
            value={s.concurrency}
            min={1}
            max={16}
            disabled={readOnly}
            onChange={(concurrency) => void update({ sftp: { concurrency } })}
          />
        </Row>
      </Section>
      <Section title={t('Édition')}>
        <Row
          label={t('Ouvrir les fichiers avec')}
          hint={t('« Modifier » dans le panneau Fichiers : l’éditeur de Tilde, ou le vôtre.')}
        >
          <Choice
            setting="sftp.editorMode"
            label={t('Ouvrir les fichiers avec')}
            value={s.editorMode}
            options={translated(EDITOR_MODES)}
            disabled={readOnly}
            onChange={(editorMode) => void update({ sftp: { editorMode } })}
          />
        </Row>
        <Row
          label={t('Éditeur externe')}
          hint={t('Commande, par exemple « code --wait ». Vide : l’éditeur de texte du système.')}
        >
          <TextField
            setting="sftp.externalEditor"
            label={t('Éditeur externe')}
            value={s.externalEditor ?? ''}
            placeholder={t('Éditeur de texte du système')}
            disabled={readOnly}
            onChange={(v) => void update({ sftp: { externalEditor: v || null } })}
          />
        </Row>
      </Section>
    </div>
  );
}
