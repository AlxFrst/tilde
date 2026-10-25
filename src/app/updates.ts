// Built-in updates: an automatic check at startup (at most once a day, can be turned off
// in Réglages → Général) and « Rechercher des mises à jour » in the palette.

import { toast } from 'sonner';
import { t } from '@/i18n';
import { onUpdateProgress, updateCheck, updateInstall, type UpdateInfo } from '@/ipc/updates';
import { dirtyEditors } from '@/stores/editors';
import { allSessions } from '@/terminal/sessionRegistry';
import { confirmClose } from './closeGuard';

export const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'tilde.updates.lastCheck';

/** Whether the startup check runs: enabled, and none in the last 24 hours. */
export function shouldAutoCheck(enabled: boolean, lastCheck: number | null, now: number): boolean {
  if (!enabled) return false;
  // A clock set back (lastCheck in the future) must not block checks for good.
  return lastCheck === null || now - lastCheck >= DAY_MS || lastCheck > now;
}

function readLastCheck(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastCheck(now: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    // Private mode or blocked storage: the next start checks again, which is fine.
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function install(): Promise<void> {
  // Installing restarts Tilde: running programs and unsaved editors would be lost.
  if (!(await confirmClose(allSessions(), dirtyEditors()))) return;
  const progress = toast.loading(t('Téléchargement de la mise à jour…'));
  const off = await onUpdateProgress((p) => {
    const text = p.total
      ? t('Téléchargement de la mise à jour… {percent} %', {
          percent: Math.round((p.downloaded / p.total) * 100),
        })
      : t('Téléchargement de la mise à jour…');
    toast.loading(text, { id: progress });
  });
  try {
    await updateInstall();
  } catch (err) {
    toast.error(errorText(err), { id: progress });
  } finally {
    off();
  }
}

function announce(update: UpdateInfo): void {
  toast(t('Tilde {version} est disponible', { version: update.version }), {
    description: t('La mise à jour redémarre Tilde.'),
    duration: Infinity,
    action: {
      label: t('Mettre à jour'),
      onClick: () => void install(),
    },
  });
}

/** `manual`: also says « à jour » and reports errors; automatic checks stay quiet. */
export async function checkForUpdates({ manual }: { manual: boolean }): Promise<void> {
  try {
    const update = await updateCheck();
    if (update) announce(update);
    else if (manual) toast.success(t('Tilde est à jour.'));
  } catch (err) {
    if (manual) {
      toast.error(t('Recherche de mise à jour impossible : {error}', { error: errorText(err) }));
    } else console.info('update check failed', err);
  }
}

/** Called once at startup by the main window. */
export function autoCheckForUpdates(enabled: boolean, now = Date.now()): void {
  if (!shouldAutoCheck(enabled, readLastCheck(), now)) return;
  writeLastCheck(now);
  void checkForUpdates({ manual: false });
}
