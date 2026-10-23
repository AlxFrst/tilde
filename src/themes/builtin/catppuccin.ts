import type { ThemeDefinition } from '../types';

// Palette: github.com/catppuccin/palette. ANSI mapping follows the official
// catppuccin/windows-terminal port.

export const catppuccinMocha: ThemeDefinition = {
  id: 'catppuccin-mocha',
  name: 'Catppuccin Mocha',
  kind: 'dark',
  ui: {
    bg: '#1E1E2E', // base
    surface1: '#181825', // mantle
    surface2: '#313244', // surface0
    border: '#45475A', // surface1
    text: '#CDD6F4',
    textMuted: '#A6ADC8', // subtext0
    accent: '#89B4FA', // blue
    accent2: '#94E2D5', // teal
    success: '#A6E3A1',
    warning: '#F9E2AF',
    error: '#F38BA8',
  },
  terminal: {
    foreground: '#CDD6F4',
    background: '#1E1E2E',
    cursor: '#F5E0DC',
    cursorAccent: '#1E1E2E',
    selectionBackground: '#9399B240',
    black: '#45475A',
    red: '#F38BA8',
    green: '#A6E3A1',
    yellow: '#F9E2AF',
    blue: '#89B4FA',
    magenta: '#F5C2E7',
    cyan: '#94E2D5',
    white: '#BAC2DE',
    brightBlack: '#585B70',
    brightRed: '#F38BA8',
    brightGreen: '#A6E3A1',
    brightYellow: '#F9E2AF',
    brightBlue: '#89B4FA',
    brightMagenta: '#F5C2E7',
    brightCyan: '#94E2D5',
    brightWhite: '#A6ADC8',
  },
};

export const catppuccinLatte: ThemeDefinition = {
  id: 'catppuccin-latte',
  name: 'Catppuccin Latte',
  kind: 'light',
  ui: {
    bg: '#EFF1F5',
    surface1: '#E6E9EF',
    surface2: '#CCD0DA',
    border: '#BCC0CC',
    text: '#4C4F69',
    textMuted: '#6C6F85',
    accent: '#1E66F5',
    accent2: '#179299',
    success: '#40A02B',
    warning: '#DF8E1D',
    error: '#D20F39',
  },
  terminal: {
    foreground: '#4C4F69',
    background: '#EFF1F5',
    cursor: '#DC8A78',
    cursorAccent: '#EFF1F5',
    selectionBackground: '#7C7F9340',
    black: '#5C5F77',
    red: '#D20F39',
    green: '#40A02B',
    yellow: '#DF8E1D',
    blue: '#1E66F5',
    magenta: '#EA76CB',
    cyan: '#179299',
    white: '#ACB0BE',
    brightBlack: '#6C6F85',
    brightRed: '#D20F39',
    brightGreen: '#40A02B',
    brightYellow: '#DF8E1D',
    brightBlue: '#1E66F5',
    brightMagenta: '#EA76CB',
    brightCyan: '#179299',
    brightWhite: '#BCC0CC',
  },
};
