/** Fonts bundled with Tilde (@fontsource): always available. */
export const BUNDLED_FONTS = ['JetBrains Mono Variable', 'Geist Mono Variable', 'Geist Variable'];

export const TERMINAL_FONT_SUGGESTIONS = [
  'JetBrains Mono Variable',
  'Geist Mono Variable',
  'Cascadia Mono',
  'Consolas',
  'Fira Code',
  'Menlo',
  'SF Mono',
  'DejaVu Sans Mono',
];
export const UI_FONT_SUGGESTIONS = ['Geist Variable', 'Segoe UI', 'Inter', 'SF Pro Text', 'Ubuntu'];

const SAMPLE = 'mmmmmmmmmmlli01OO@#';

/** A font name safe inside CSS double quotes. */
export function cssFontName(name: string): string {
  return name.replace(/["\\;{}<>]/g, '').trim();
}

/**
 * Whether `name` is installed: the browser falls back silently, so text is measured with
 * the font then with each fallback alone; a missing font measures like its fallbacks.
 */
export function isFontAvailable(name: string, measure: (font: string) => number): boolean {
  const safe = cssFontName(name);
  if (!safe) return false;
  return ['monospace', 'serif'].some((base) => measure(`"${safe}", ${base}`) !== measure(base));
}

let canvas: OffscreenCanvasRenderingContext2D | null | undefined;

/** Measures with a canvas, or `null` where none exists (tests). */
export function canvasMeasure(): ((font: string) => number) | null {
  if (canvas === undefined) {
    canvas =
      typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  }
  const ctx = canvas;
  if (!ctx) return null;
  return (font) => {
    ctx.font = `32px ${font}`;
    return ctx.measureText(SAMPLE).width;
  };
}
