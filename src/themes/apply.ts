import type { ThemeDefinition, UiTokens } from './types';

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/** Writes the theme's UI tokens as `--tilde-*` CSS variables on `root`. */
export function applyTheme(
  theme: ThemeDefinition,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(theme.ui) as [keyof UiTokens, string][]) {
    root.style.setProperty(`--tilde-${kebab(key)}`, value);
  }
  root.dataset.themeKind = theme.kind;
  root.style.colorScheme = theme.kind;
}
