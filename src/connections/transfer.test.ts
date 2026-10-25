import { toast } from 'sonner';
import { setLocale } from '@/i18n';
import { exportConnections, importConnections } from '@/ipc/connections';
import { exportWithToast, importWithReport } from './transfer';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/ipc/connections', () => ({ importConnections: vi.fn(), exportConnections: vi.fn() }));

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

test('import reports what was imported and skipped', async () => {
  vi.mocked(importConnections).mockResolvedValueOnce({ imported: 3, skipped: 1, review: [] });
  await importWithReport();
  expect(toast.success).toHaveBeenCalledWith(
    '3 connexions importées, 1 ignorée (déjà présentes ou invalides)',
  );

  vi.mocked(importConnections).mockResolvedValueOnce({ imported: 1, skipped: 0, review: [] });
  await importWithReport();
  expect(toast.success).toHaveBeenLastCalledWith('1 connexion importée');
});

test('cancelling says nothing; failures are shown', async () => {
  vi.mocked(importConnections).mockResolvedValueOnce(null);
  vi.mocked(exportConnections).mockResolvedValueOnce(false);
  await importWithReport();
  await exportWithToast();
  expect(toast.success).not.toHaveBeenCalled();

  vi.mocked(importConnections).mockRejectedValueOnce({
    kind: 'parse',
    message: 'EOF',
    line: 2,
    column: 1,
  });
  await importWithReport();
  expect(toast.error).toHaveBeenCalledWith('Fichier importé ligne 2, colonne 1 : EOF');
});

test('imported keys and jump hosts are named for review', async () => {
  vi.mocked(importConnections).mockResolvedValueOnce({
    imported: 2,
    skipped: 0,
    review: ['unc', 'jump'],
  });
  await importWithReport();
  expect(toast.success).toHaveBeenLastCalledWith('2 connexions importées', {
    description:
      'À vérifier : unc, jump (clé ou bastion importés). Le transfert d’agent n’est jamais importé.',
  });
});

test('reports in English, with English plurals', async () => {
  setLocale('en');
  vi.mocked(importConnections).mockResolvedValueOnce({ imported: 0, skipped: 1, review: [] });
  await importWithReport();
  expect(toast.success).toHaveBeenLastCalledWith(
    '0 connections imported, 1 skipped (already present or invalid)',
  );

  vi.mocked(importConnections).mockRejectedValueOnce({
    kind: 'parse',
    message: 'EOF',
    line: 2,
    column: 1,
  });
  await importWithReport();
  expect(toast.error).toHaveBeenCalledWith('Imported file line 2, column 1: EOF');
});
