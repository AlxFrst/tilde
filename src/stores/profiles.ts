import { create } from 'zustand';
import { listProfiles, refreshProfiles, type ResolvedProfile } from '@/ipc/profiles';

interface ProfilesState {
  profiles: ResolvedProfile[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Re-detects shells (e.g. after installing a WSL distribution). */
  refresh: () => Promise<void>;
}

export const useProfiles = create<ProfilesState>()((set) => ({
  profiles: [],
  loaded: false,
  load: async () => {
    set({ profiles: await listProfiles(), loaded: true });
  },
  refresh: async () => {
    set({ profiles: await refreshProfiles(), loaded: true });
  },
}));
