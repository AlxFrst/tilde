import { FitAddon } from '@xterm/addon-fit';
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
  dispose(): void;
}

type TerminalSettings = Settings['terminal'];

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
    dispose() {
      webgl?.dispose();
      term.dispose();
    },
  };
}
