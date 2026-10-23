import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import type { ThemeDefinition } from './types';
import { useResolvedTheme } from './useResolvedTheme';

const DEFAULT_CHOICE = {
  colorScheme: 'system',
  themeDark: 'tilde-dark',
  themeLight: 'tilde-light',
} as const;

/**
 * The theme the whole window shows: the one being edited (live preview), else the one
 * chosen in the settings. The only theme source for the CSS tokens and the terminals.
 */
export function useActiveTheme(): ThemeDefinition {
  const appearance = useSettings((s) => s.settings?.appearance);
  const user = useThemes((s) => s.user);
  const preview = useThemes((s) => s.preview);
  const resolved = useResolvedTheme(appearance ?? DEFAULT_CHOICE, user);
  return preview ?? resolved;
}
