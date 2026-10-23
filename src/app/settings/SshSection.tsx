import type { Settings } from '@/ipc/generated/settings';
import { useSettings } from '@/stores/settings';
import { NumberField, Row, Section, SwitchField } from './fields';

export function SshSection() {
  const settings = useSettings((s) => s.settings);
  const readOnly = useSettings((s) => s.readOnly);
  const update = useSettings((s) => s.update);
  if (!settings) return null;
  const s = settings.ssh;
  const set = (patch: Partial<Settings['ssh']>) => void update({ ssh: patch });

  return (
    <div className="grid gap-6">
      <Section title="Connexion">
        <Row label="Keepalive" hint="Intervalle des messages de maintien ; 0 = désactivé.">
          <NumberField
            setting="ssh.keepaliveIntervalSecs"
            label="Intervalle keepalive"
            value={s.keepaliveIntervalSecs}
            min={0}
            max={3600}
            unit="s"
            disabled={readOnly}
            onChange={(keepaliveIntervalSecs) => {
              set({ keepaliveIntervalSecs });
            }}
          />
        </Row>
        <Row label="Réponses manquées" hint="Avant de considérer la connexion perdue.">
          <NumberField
            setting="ssh.keepaliveCountMax"
            label="Keepalive sans réponse"
            value={s.keepaliveCountMax}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(keepaliveCountMax) => {
              set({ keepaliveCountMax });
            }}
          />
        </Row>
        <Row label="Reconnexion automatique" hint="Un nouveau shell est ouvert après une coupure.">
          <SwitchField
            setting="ssh.autoReconnect"
            label="Reconnexion automatique"
            checked={s.autoReconnect}
            disabled={readOnly}
            onChange={(autoReconnect) => {
              set({ autoReconnect });
            }}
          />
        </Row>
        <Row label="Confirmer la fermeture d’un onglet SSH">
          <SwitchField
            setting="ssh.confirmCloseSsh"
            label="Confirmer la fermeture d’un onglet SSH"
            checked={s.confirmCloseSsh}
            disabled={readOnly}
            onChange={(confirmCloseSsh) => {
              set({ confirmCloseSsh });
            }}
          />
        </Row>
      </Section>
    </div>
  );
}
