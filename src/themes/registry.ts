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

export function getTheme(id: string): ThemeDefinition | undefined {
  return builtinThemes.find((t) => t.id === id);
}
