import { catppuccinLatte, catppuccinMocha } from './builtin/catppuccin';
import { dracula } from './builtin/dracula';
import { gruvboxDark, gruvboxLight } from './builtin/gruvbox';
import { nord } from './builtin/nord';
import { oneDark, oneLight } from './builtin/one';
import { rosePine, rosePineDawn } from './builtin/rose-pine';
import { tildeDark, tildeLight } from './builtin/tilde';
import { tokyoNight, tokyoNightDay } from './builtin/tokyo-night';
import type { ThemeDefinition } from './types';

export const builtinThemes: readonly ThemeDefinition[] = [
  tildeDark,
  tildeLight,
  catppuccinMocha,
  catppuccinLatte,
  tokyoNight,
  tokyoNightDay,
  dracula,
  nord,
  gruvboxDark,
  gruvboxLight,
  oneDark,
  oneLight,
  rosePine,
  rosePineDawn,
];

/** A builtin theme by id. */
export function getTheme(id: string): ThemeDefinition | undefined {
  return builtinThemes.find((t) => t.id === id);
}

/** Builtin themes first, then the user's, sorted by name. */
export function allThemes(user: readonly ThemeDefinition[]): ThemeDefinition[] {
  return [...builtinThemes, ...[...user].sort((a, b) => a.name.localeCompare(b.name))];
}

/** A builtin or user theme by id (builtin ids cannot be shadowed). */
export function findTheme(
  id: string,
  user: readonly ThemeDefinition[],
): ThemeDefinition | undefined {
  return getTheme(id) ?? user.find((t) => t.id === id);
}
