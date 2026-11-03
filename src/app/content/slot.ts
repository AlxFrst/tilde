import type { CSSProperties } from 'react';
import type { Rect } from '@/workspace/tree';

const pct = (f: number) => `${String(f * 100)}%`;

/**
 * Where a session of the side-by-side view (or a drop preview) sits in the content area:
 * its rectangle, 3 px in from each side, so two sessions are 6 px apart.
 */
export function slotStyle(r: Rect): CSSProperties {
  return {
    left: `calc(${pct(r.x)} + 3px)`,
    top: `calc(${pct(r.y)} + 3px)`,
    width: `calc(${pct(r.w)} - 6px)`,
    height: `calc(${pct(r.h)} - 6px)`,
  };
}
