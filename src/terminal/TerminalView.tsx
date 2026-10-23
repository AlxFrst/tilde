import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { SearchAddon } from '@xterm/addon-search';
import { ClipboardPaste, Copy, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ackSession,
  closeSession,
  isSessionError,
  openSession,
  resizeSession,
  writeSession,
  type SessionErrorDto,
} from '@/ipc/session';
import { useSettings } from '@/stores/settings';
import { toXtermTheme, useResolvedTheme } from '@/themes';
import type { TerminalPanel } from '@/workspace/types';
import { createTerminal, terminalOptions, type TerminalHandle } from './createTerminal';
import { ExitOverlay } from './ExitOverlay';
import { matchShortcut } from './keys';
import { parseOsc7 } from './osc7';
import { needsPasteConfirmation, pastedLineCount } from './paste';
import { createResizeScheduler } from './resize';
import { SearchBar } from './SearchBar';
import { registerSession, unregisterSession } from './sessionRegistry';

export interface TerminalViewProps {
  tabId: string;
  leafId: string;
  panel: TerminalPanel;
  active: boolean;
  onExit: (code: number | null) => void;
  onTitle: (title: string) => void;
  onCwd: (cwd: string) => void;
  onSessionError: (err: SessionErrorDto) => void;
  /** The user dismissed the exit overlay. */
  onClose: () => void;
}

/**
 * Per-session bookkeeping. Output (ConPTY's cursor-position request in particular) can
 * arrive before `session_open` returns the id; input and acks are queued until then,
 * otherwise the shell would wait forever for the terminal's reply.
 */
interface SessionState {
  id: number | null;
  pendingInput: (string | Uint8Array)[];
  pendingAck: number;
  ended: boolean;
  disposed: boolean;
}

const DEFAULT_CHOICE = {
  colorScheme: 'system',
  themeDark: 'tilde-dark',
  themeLight: 'tilde-light',
} as const;
const noop = () => undefined;

function errorText(err: unknown): string {
  if (isSessionError(err)) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function TerminalView(props: TerminalViewProps) {
  const terminalSettings = useSettings((s) => s.settings?.terminal);
  const appearance = useSettings((s) => s.settings?.appearance);
  const theme = useResolvedTheme(appearance ?? DEFAULT_CHOICE);

  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<TerminalHandle | null>(null);
  const session = useRef<SessionState | null>(null);
  const latest = useRef({ props, terminalSettings, theme });
  useLayoutEffect(() => {
    latest.current = { props, terminalSettings, theme };
  });

  const [generation, setGeneration] = useState(0);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [pasteText, setPasteText] = useState<string | null>(null);

  const send = (data: string | Uint8Array) => {
    const s = session.current;
    if (!s || s.ended) return;
    if (s.id === null) s.pendingInput.push(data);
    else writeSession(s.id, data).catch(noop);
  };

  const copySelection = () => {
    const term = handle.current?.term;
    if (term?.hasSelection()) void writeText(term.getSelection());
  };

  const requestPaste = (text: string) => {
    const term = handle.current?.term;
    if (!term || !text) return;
    if (needsPasteConfirmation(text, term.modes.bracketedPasteMode)) setPasteText(text);
    else term.paste(text);
  };

  const pasteFromClipboard = () => {
    readText().then(requestPaste, noop);
  };

  // Create the terminal once.
  useEffect(() => {
    const el = container.current;
    const { terminalSettings: ts, theme: th } = latest.current;
    if (!el || !ts) return;
    const h = createTerminal({ container: el, settings: ts, theme: toXtermTheme(th.terminal) });
    handle.current = h;
    setSearchAddon(h.search);
    const { term } = h;

    const scheduler = createResizeScheduler((cols, rows) => {
      const id = session.current?.id;
      if (id != null) resizeSession(id, cols, rows).catch(noop);
    });
    const fitAndResize = () => {
      try {
        h.fit.fit();
      } catch {
        return; // not laid out yet
      }
      scheduler.schedule(term.cols, term.rows);
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(el);

    const subscriptions = [
      term.onData(send),
      term.onBinary((d) => {
        send(Uint8Array.from(d, (c) => c.charCodeAt(0)));
      }),
      term.onTitleChange((title) => {
        latest.current.props.onTitle(title);
      }),
      term.onSelectionChange(() => {
        if (latest.current.terminalSettings?.copyOnSelect) copySelection();
      }),
      term.parser.registerOscHandler(7, (data) => {
        const cwd = parseOsc7(data);
        if (cwd) latest.current.props.onCwd(cwd);
        return true;
      }),
    ];

    term.attachCustomKeyEventHandler((e) => {
      const command = matchShortcut(e);
      if (!command) return true;
      if (e.type === 'keydown') {
        if (command === 'terminal.copy') copySelection();
        else if (command === 'terminal.paste') pasteFromClipboard();
        else if (command === 'terminal.search') setSearchOpen(true);
      }
      // Every app shortcut is handled by Tilde, never sent to the shell.
      return false;
    });

    return () => {
      observer.disconnect();
      scheduler.dispose();
      subscriptions.forEach((s) => {
        s.dispose();
      });
      handle.current = null;
      h.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; reads latest values via refs
  }, []);

  // Start (or restart) the shell.
  useEffect(() => {
    const h = handle.current;
    if (!h) return;
    const s: SessionState = {
      id: null,
      pendingInput: [],
      pendingAck: 0,
      ended: false,
      disposed: false,
    };
    session.current = s;
    try {
      h.fit.fit();
    } catch {
      // keep xterm's default size
    }
    const opened = { cols: h.term.cols, rows: h.term.rows };
    const ack = (bytes: number) => {
      if (s.disposed) return;
      if (s.id === null) s.pendingAck += bytes;
      else ackSession(s.id, bytes).catch(noop);
    };
    const { panel } = latest.current.props;

    openSession({
      profileId: panel.profileId,
      cwd: panel.cwd,
      cols: opened.cols,
      rows: opened.rows,
      onData: (data) => {
        if (!s.disposed)
          h.term.write(data, () => {
            ack(data.length);
          });
      },
      onExit: (code) => {
        if (s.disposed) return;
        s.ended = true;
        unregisterSession(latest.current.props.leafId);
        setExitCode(code);
        latest.current.props.onExit(code);
      },
    }).then(
      ({ id }) => {
        if (s.disposed) {
          closeSession(id).catch(noop);
          return;
        }
        s.id = id;
        registerSession(latest.current.props.leafId, id);
        for (const d of s.pendingInput.splice(0)) writeSession(id, d).catch(noop);
        if (s.pendingAck > 0) ackSession(id, s.pendingAck).catch(noop);
        s.pendingAck = 0;
        if (h.term.cols !== opened.cols || h.term.rows !== opened.rows) {
          resizeSession(id, h.term.cols, h.term.rows).catch(noop);
        }
      },
      (err: unknown) => {
        if (s.disposed) return;
        s.ended = true;
        h.term.write(`\r\n\u001b[31m${errorText(err)}\u001b[0m\r\n`);
        if (isSessionError(err)) latest.current.props.onSessionError(err);
      },
    );

    return () => {
      s.disposed = true;
      unregisterSession(latest.current.props.leafId);
      if (s.id !== null && !s.ended) closeSession(s.id).catch(noop);
    };
  }, [generation]);

  // Live settings and theme updates: no new session, just new options.
  useEffect(() => {
    const h = handle.current;
    if (!h || !terminalSettings) return;
    h.term.options = terminalOptions(terminalSettings, toXtermTheme(theme.terminal));
    try {
      h.fit.fit();
    } catch {
      // not laid out yet
    }
  }, [terminalSettings, theme]);

  useEffect(() => {
    if (props.active) handle.current?.term.focus();
  }, [props.active]);

  const rightClick = terminalSettings?.rightClick ?? 'menu';
  const onContextMenu = (e: React.MouseEvent) => {
    if (rightClick === 'menu') return;
    e.preventDefault();
    const term = handle.current?.term;
    if (rightClick === 'copyPaste' && term?.hasSelection()) {
      copySelection();
      term.clearSelection();
    } else {
      pasteFromClipboard();
    }
  };

  const restart = () => {
    handle.current?.term.reset();
    setExitCode(undefined);
    setGeneration((g) => g + 1);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--tilde-bg)]">
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={rightClick !== 'menu'}>
          <div
            ref={container}
            className="h-full w-full px-2 pt-1"
            style={{ backgroundColor: theme.terminal.background }}
            onContextMenu={onContextMenu}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={copySelection}>
            <Copy strokeWidth={1.5} /> Copier <ContextMenuShortcut>Ctrl+Maj+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={pasteFromClipboard}>
            <ClipboardPaste strokeWidth={1.5} /> Coller{' '}
            <ContextMenuShortcut>Ctrl+Maj+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setSearchOpen(true);
            }}
          >
            <Search strokeWidth={1.5} /> Rechercher{' '}
            <ContextMenuShortcut>Ctrl+Maj+F</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {searchOpen && searchAddon && (
        <SearchBar
          search={searchAddon}
          theme={theme}
          onClose={() => {
            setSearchOpen(false);
            handle.current?.term.focus();
          }}
        />
      )}

      {exitCode !== undefined && (
        <ExitOverlay code={exitCode} onRestart={restart} onClose={props.onClose} />
      )}

      <Dialog
        open={pasteText !== null}
        onOpenChange={(open) => {
          if (!open) setPasteText(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coller {pasteText ? pastedLineCount(pasteText) : 0} lignes ?</DialogTitle>
            <DialogDescription>Chaque ligne sera exécutée par le shell.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-40 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs select-text">
            {pasteText}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPasteText(null);
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (pasteText) handle.current?.term.paste(pasteText);
                setPasteText(null);
                handle.current?.term.focus();
              }}
            >
              Coller
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
