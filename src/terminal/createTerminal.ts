import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon, type IImageAddonOptions } from '@xterm/addon-image';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITerminalOptions, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Settings } from '@/ipc/generated/settings';
import { openUrl } from '@/ipc/session';

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  /**
   * Clears the terminal for a new session. Unlike `term.reset()`, it also drops the old
   * session's images: xterm's own reset leaves them in the image store until evicted.
   */
  reset(): void;
  dispose(): void;
}

type TerminalSettings = Settings['terminal'];

/**
 * Images in the terminal: Sixel (img2sixel, chafa, lsix, matplotlib…) and iTerm2's inline
 * images (imgcat, viu, yazi…). Whatever runs in the session decides what is sent, often a
 * remote server, so these limits are the protection against a flood: never raise them.
 * Every limit is spelled out, so an addon upgrade cannot change one behind our back.
 */
export const IMAGE_ADDON_OPTIONS = {
  sixelSupport: true,
  iipSupport: true,
  // Tools scale their pictures to the window: they ask for the cell and window size in
  // pixels (CSI 14/16/18 t), and without an answer they guess.
  enableSizeReports: true,
  // An image evicted from the store leaves a hatched band in the scrollback, not a hole.
  showPlaceholder: true,
  // Not the default (128 MB): the store is per terminal and a user keeps many sessions
  // open. The oldest images go first; a single image larger than this still shows, alone.
  storageLimit: 32,
  // The addon's defaults, pinned: 4096 × 4096 pixels per image, 25 MB per Sixel sequence,
  // 20 MB per inline image. Inline images are checked at their source size, before being
  // fitted to the window, so a lower pixel limit would refuse an ordinary 12 MP phone photo.
  pixelLimit: 4096 * 4096,
  sixelSizeLimit: 25_000_000,
  iipSizeLimit: 20_000_000,
} as const satisfies IImageAddonOptions;

/** xterm options derived from settings; also used for live updates. */
export function terminalOptions(s: TerminalSettings, theme: ITheme): ITerminalOptions {
  return {
    fontFamily: `"${s.fontFamily}", "JetBrains Mono Variable", ui-monospace, monospace`,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
    theme,
    // A translucent background (window opacity below 1) needs it; it costs a little.
    allowTransparency: (theme.background?.length ?? 0) > 7,
  };
}

/**
 * Creates an xterm instance in `container` with Tilde's addons. WebGL is optional: without
 * a GPU context the terminal keeps working with the DOM renderer.
 *
 * Ligatures are drawn by a character joiner (see ligatures.ts), with the WebGL renderer
 * only: the DOM fallback shows the characters separately.
 */
export function createTerminal(opts: {
  container: HTMLElement;
  settings: TerminalSettings;
  theme: ITheme;
}): TerminalHandle {
  const term = new Terminal({
    ...terminalOptions(opts.settings, opts.theme),
    allowProposedApi: true,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: false,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new SerializeAddon());
  term.loadAddon(
    new WebLinksAddon((_event, uri) => {
      void openUrl(uri);
    }),
  );
  term.open(opts.container);

  // The addon draws on a canvas of its own above the text, and wraps xterm's renderer switch
  // to put that canvas back on top of whichever renderer is current: WebGL, or the DOM one
  // after a lost context. Images are optional: the addon reaches into xterm's internals, and
  // if that ever breaks, the terminal must still open, without pictures.
  let images: ImageAddon | null = null;
  try {
    images = new ImageAddon(IMAGE_ADDON_OPTIONS);
    term.loadAddon(images);
  } catch (err) {
    console.warn('Image support unavailable; Sixel and inline images will not show', err);
    images?.dispose();
    images = null;
  }

  let webgl: WebglAddon | null = null;
  try {
    webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      console.warn('WebGL context lost; falling back to the DOM renderer');
      webgl?.dispose();
      webgl = null;
    });
    term.loadAddon(webgl);
  } catch (err) {
    console.warn('WebGL renderer unavailable; using the DOM renderer', err);
    webgl = null;
  }

  return {
    term,
    fit,
    search,
    reset() {
      term.reset();
      images?.reset();
    },
    dispose() {
      // Images first: their canvases are freed and xterm gets its renderer switch back
      // before WebGL, on its way out, swaps in the DOM renderer.
      images?.dispose();
      webgl?.dispose();
      term.dispose();
    },
  };
}
