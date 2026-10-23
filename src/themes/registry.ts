import { catppuccinLatte, catppuccinMocha } from './builtin/catppuccin';
import { tildeDark, tildeLight } from './builtin/tilde';
import type { ThemeDefinition } from './types';

export const builtinThemes: readonly ThemeDefinition[] = [
  tildeDark,
  tildeLight,
  catppuccinMocha,
  catppuccinLatte,
];

export function getTheme(id: string): ThemeDefinition | undefined {
  return builtinThemes.find((t) => t.id === id);
}
