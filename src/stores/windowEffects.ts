import { create } from 'zustand';
import type { AppliedEffect, WindowEffect } from '@/ipc/window';

/** The window effect actually shown, and the ones this system supports. */
export const useWindowEffects = create<{ applied: AppliedEffect; supported: WindowEffect[] }>()(
  () => ({ applied: 'none', supported: ['none'] }),
);
