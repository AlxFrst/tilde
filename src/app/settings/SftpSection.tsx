import { useSettings } from '@/stores/settings';
import { Choice, NumberField, Row, Section, TextField } from './fields';

const EDITOR_MODES = [
  ['external', 'Éditeur externe'],
  ['builtin', 'Éditeur intégré'],
] as const;

export function SftpSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  if (!settings) return null;
  const s = settings.sftp;

  return (
    <div className="grid gap-6">
      <Section title="Transferts">
        <Row label="Transferts simultanés">
          <NumberField
            setting="sftp.concurrency"
            label="Transferts simultanés"
            value={s.concurrency}
            min={1}
            max={16}
            disabled={readOnly}
            onChange={(concurrency) => void update({ sftp: { concurrency } })}
          />
        </Row>
      </Section>
      <Section title="Édition">
        <Row
          label="Ouvrir les fichiers avec"
          hint="« Modifier » dans le panneau Fichiers : l’éditeur de Tilde, ou le vôtre."
        >
          <Choice
            setting="sftp.editorMode"
            label="Ouvrir les fichiers avec"
            value={s.editorMode}
            options={EDITOR_MODES}
            disabled={readOnly}
            onChange={(editorMode) => void update({ sftp: { editorMode } })}
          />
        </Row>
        <Row
          label="Éditeur externe"
          hint="Commande, par exemple « code --wait ». Vide : l’éditeur de texte du système."
        >
          <TextField
            setting="sftp.externalEditor"
            label="Éditeur externe"
            value={s.externalEditor ?? ''}
            placeholder="Éditeur de texte du système"
            disabled={readOnly}
            onChange={(v) => void update({ sftp: { externalEditor: v || null } })}
          />
        </Row>
      </Section>
    </div>
  );
}
