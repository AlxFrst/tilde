import { msg } from '@/i18n';

/** Colours a session can be tagged with (name, shown with t(); CSS value). */
export const TAB_COLORS = [
  [msg('Pervenche'), 'var(--tilde-accent)'],
  [msg('Turquoise'), 'var(--tilde-accent-2)'],
  [msg('Vert'), 'var(--tilde-success)'],
  [msg('Ambre'), 'var(--tilde-warning)'],
  [msg('Rouge'), 'var(--tilde-error)'],
] as const;
