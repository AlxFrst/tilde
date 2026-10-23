import type { ITheme } from '@xterm/xterm';
import type { TerminalColors } from './types';

export function toXtermTheme(t: TerminalColors): ITheme {
  return { ...t };
}
