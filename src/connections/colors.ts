import { msg } from '@/i18n';

/** Colours offered for connections and folders (stored as #RRGGBB); names shown with t(). */
export const CONNECTION_COLORS = [
  [msg('Pervenche'), '#7AA2F7'],
  [msg('Turquoise'), '#5EEAD4'],
  [msg('Vert'), '#9ECE6A'],
  [msg('Ambre'), '#E0AF68'],
  [msg('Rouge'), '#F7768E'],
  [msg('Violet'), '#BB9AF7'],
] as const;
