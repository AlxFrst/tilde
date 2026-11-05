import { listSpaces } from '@/connections/spaces';
import type { Space } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { useWorkspace } from '@/stores/workspace';
import { findTheme } from './registry';
import type { ThemeDefinition } from './types';
import { useResolvedTheme, type ThemeChoice } from './useResolvedTheme';

const DEFAULT_CHOICE = {
  colorScheme: 'system',
  themeDark: 'tilde-dark',
  themeLight: 'tilde-light',
} as const;

/** The space this window shows. */
export function useActiveSpace(): Space | undefined {
  const file = useConnections((s) => s.file);
  const activeSpace = useWorkspace((s) => s.activeSpaceId);
  return listSpaces(file).find((s) => s.id === activeSpace);
}

/** A space's themes over the global choice; one it no longer finds leaves the global one. */
export function spaceThemeChoice(
  choice: ThemeChoice,
  space: Pick<Space, 'themeDark' | 'themeLight'> | undefined,
  user: readonly ThemeDefinition[],
): ThemeChoice {
  const known = (id: string | null | undefined) => (id && findTheme(id, user) ? id : null);
  return {
    ...choice,
    themeDark: known(space?.themeDark) ?? choice.themeDark,
    themeLight: known(space?.themeLight) ?? choice.themeLight,
  };
}

/**
 * The theme the whole window shows: the one being edited (live preview), else the active
 * space's when themes per space are on, else the one chosen in the settings. The only theme
 * source for the CSS tokens and the terminals.
 */
export function useActiveTheme(): ThemeDefinition {
  const appearance = useSettings((s) => s.settings?.appearance);
  const user = useThemes((s) => s.user);
  const preview = useThemes((s) => s.preview);
  const space = useActiveSpace();
  const choice = appearance ?? DEFAULT_CHOICE;
  const resolved = useResolvedTheme(
    appearance?.themePerSpace ? spaceThemeChoice(choice, space, user) : choice,
    user,
  );
  return preview ?? resolved;
}
