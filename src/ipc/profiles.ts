import { invoke } from '@tauri-apps/api/core';

/** Mirrors `ResolvedProfile` in crates/tilde-pty/src/profiles.rs. */
export interface ResolvedProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  /** `powershell`, `cmd`, `git`, `linux`, `terminal`, or a user value. */
  icon: string;
  color: string | null;
  source: 'detected' | 'user';
}

export const listProfiles = () => invoke<ResolvedProfile[]>('profiles_list');
export const refreshProfiles = () => invoke<ResolvedProfile[]>('profiles_refresh');

/** Same rule as `pick_default` in Rust: the wanted profile if it exists, else the first. */
export function pickDefaultProfile(
  profiles: ResolvedProfile[],
  wanted: string | null,
): ResolvedProfile | null {
  return profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null;
}
