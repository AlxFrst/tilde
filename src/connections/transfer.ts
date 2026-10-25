import { toast } from 'sonner';
import { t, tn } from '@/i18n';
import { exportConnections, importConnections } from '@/ipc/connections';
import { formatConfigError, isConfigError } from '@/ipc/errors';

/** `file` names what the error is about: the imported file is not connections.json. */
function fail(err: unknown, file: string): void {
  toast.error(isConfigError(err) ? formatConfigError(err, file) : String(err));
}

/** Asks for a file and imports it; says what was imported. Silent if cancelled. */
export async function importWithReport(): Promise<void> {
  try {
    const report = await importConnections();
    if (!report) return;
    const imported = tn(
      report.imported,
      '{count} connexion importée',
      '{count} connexions importées',
    );
    const title = report.skipped
      ? t('{imported}, {skipped} (déjà présentes ou invalides)', {
          imported,
          skipped: tn(report.skipped, '{count} ignorée', '{count} ignorées'),
        })
      : imported;
    if (report.review.length > 0) {
      toast.success(title, {
        description: t(
          'À vérifier : {names} (clé ou bastion importés). Le transfert d’agent n’est jamais importé.',
          { names: report.review.join(', ') },
        ),
      });
    } else {
      toast.success(title);
    }
  } catch (err) {
    fail(err, t('Fichier importé'));
  }
}

/** Asks where to save and exports. Silent if cancelled. */
export async function exportWithToast(): Promise<void> {
  try {
    if (await exportConnections()) {
      toast.success(t('Connexions exportées (aucun mot de passe n’est inclus)'));
    }
  } catch (err) {
    fail(err, 'connections.json');
  }
}
