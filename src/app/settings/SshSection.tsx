import { t } from '@/i18n';
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
      <Section title={t('Connexion')}>
        <Row label="Keepalive" hint={t('Intervalle des messages de maintien ; 0 = désactivé.')}>
          <NumberField
            setting="ssh.keepaliveIntervalSecs"
            label={t('Intervalle keepalive')}
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
        <Row label={t('Réponses manquées')} hint={t('Avant de considérer la connexion perdue.')}>
          <NumberField
            setting="ssh.keepaliveCountMax"
            label={t('Keepalive sans réponse')}
            value={s.keepaliveCountMax}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(keepaliveCountMax) => {
              set({ keepaliveCountMax });
            }}
          />
        </Row>
        <Row
          label={t('Reconnexion automatique')}
          hint={t('Un nouveau shell est ouvert après une coupure.')}
        >
          <SwitchField
            setting="ssh.autoReconnect"
            label={t('Reconnexion automatique')}
            checked={s.autoReconnect}
            disabled={readOnly}
            onChange={(autoReconnect) => {
              set({ autoReconnect });
            }}
          />
        </Row>
        <Row label={t('Confirmer la fermeture d’un onglet SSH')}>
          <SwitchField
            setting="ssh.confirmCloseSsh"
            label={t('Confirmer la fermeture d’un onglet SSH')}
            checked={s.confirmCloseSsh}
            disabled={readOnly}
            onChange={(confirmCloseSsh) => {
              set({ confirmCloseSsh });
            }}
          />
        </Row>
        <Row
          label={t('Bandeau d’état du serveur')}
          hint={t(
            'Sous chaque terminal SSH : processeur, mémoire, disque et réseau de la machine.',
          )}
        >
          <SwitchField
            setting="ssh.statusBar"
            label={t('Bandeau d’état du serveur')}
            checked={s.statusBar}
            disabled={readOnly}
            onChange={(statusBar) => {
              set({ statusBar });
            }}
          />
        </Row>
      </Section>
    </div>
  );
}
