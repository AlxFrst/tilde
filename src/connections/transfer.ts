import { toast } from 'sonner';
import { exportConnections, importConnections } from '@/ipc/connections';
import { formatConfigError, isConfigError } from '@/ipc/errors';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n > 1 ? many : one}`;

/** `file` names what the error is about: the imported file is not connections.json. */
function fail(err: unknown, file: string): void {
  toast.error(isConfigError(err) ? formatConfigError(err, file) : String(err));
}

/** Asks for a file and imports it; says what was imported. Silent if cancelled. */
export async function importWithReport(): Promise<void> {
  try {
    const report = await importConnections();
    if (!report) return;
    const skipped = report.skipped
      ? `, ${plural(report.skipped, 'ignorée', 'ignorées')} (déjà présentes ou invalides)`
      : '';
    const title = `${plural(report.imported, 'connexion importée', 'connexions importées')}${skipped}`;
    if (report.review.length > 0) {
      toast.success(title, {
        description: `À vérifier : ${report.review.join(', ')} (clé ou bastion importés). Le transfert d’agent n’est jamais importé.`,
      });
    } else {
      toast.success(title);
    }
  } catch (err) {
    fail(err, 'Fichier importé');
  }
}

/** Asks where to save and exports. Silent if cancelled. */
export async function exportWithToast(): Promise<void> {
  try {
    if (await exportConnections()) {
      toast.success('Connexions exportées (aucun mot de passe n’est inclus)');
    }
  } catch (err) {
    fail(err, 'connections.json');
  }
}
