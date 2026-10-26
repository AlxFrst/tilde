// Who the files of each SSH session are read and written as: the login user, or another
// one through sudo (`sftp_switch_user`). Shared by every files pane and editor of the
// session; forgotten with the app (a restart reads the files as the login user again).

import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { sftpIdentity, sftpSwitchUser, type SftpIdentity } from '@/ipc/sftp';
import { isSessionError } from '@/ipc/session';

interface SftpUsersState {
  bySession: Record<number, SftpIdentity>;
  /** Reads a session's current user (once it is connected). */
  load: (sessionId: number) => Promise<void>;
  /**
   * Reads and writes the session's files as `user` through sudo (`null`: the login user).
   * Resolves to false when refused or cancelled; a refusal is told in a toast.
   */
  switchTo: (sessionId: number, user: string | null) => Promise<boolean>;
}

export const useSftpUsers = create<SftpUsersState>()((set, get) => ({
  bySession: {},

  load: async (sessionId) => {
    try {
      const identity = await sftpIdentity(sessionId);
      set((s) => ({ bySession: { ...s.bySession, [sessionId]: identity } }));
    } catch {
      // The session is gone: nothing to show.
    }
  },

  switchTo: async (sessionId, user) => {
    try {
      const identity = await sftpSwitchUser(sessionId, user);
      set((s) => ({ bySession: { ...s.bySession, [sessionId]: identity } }));
      const shown = identity.user ?? identity.login;
      if (shown) toast.success(t('Fichiers en tant que {user}', { user: shown }));
      return true;
    } catch (e) {
      if (isSessionError(e) && e.kind === 'cancelled') return false;
      const login = get().bySession[sessionId]?.login;
      toast.error(
        t('Impossible de passer en {user} : {error}', {
          user: user ?? login ?? '?',
          error: isSessionError(e) ? e.message : String(e),
        }),
      );
      return false;
    }
  },
}));
