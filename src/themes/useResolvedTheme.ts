import { useSyncExternalStore } from 'react';
import type { Appearance } from '@/ipc/generated/settings';
import { tildeDark, tildeLight } from './builtin/tilde';
import { findTheme } from './registry';
import type { ThemeDefinition } from './types';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => {
    mql.removeEventListener('change', onChange);
  };
}

const prefersDark = () => window.matchMedia(QUERY).matches;

export type ThemeChoice = Pick<Appearance, 'colorScheme' | 'themeDark' | 'themeLight'>;

/** Pure resolution: which theme to show for these settings and OS preference. */
export function resolveTheme(
  choice: ThemeChoice,
  osPrefersDark: boolean,
  user: readonly ThemeDefinition[] = [],
): ThemeDefinition {
  const dark = choice.colorScheme === 'dark' || (choice.colorScheme === 'system' && osPrefersDark);
  return dark
    ? (findTheme(choice.themeDark, user) ?? tildeDark)
    : (findTheme(choice.themeLight, user) ?? tildeLight);
}

/** The theme for these settings, re-evaluated when the OS switches between light and dark. */
export function useResolvedTheme(
  choice: ThemeChoice,
  user: readonly ThemeDefinition[] = [],
): ThemeDefinition {
  const osDark = useSyncExternalStore(subscribe, prefersDark);
  return resolveTheme(choice, osDark, user);
}
