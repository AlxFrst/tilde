import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { SearchAddon } from '@xterm/addon-search';
import { ClipboardPaste, Columns2, Copy, Rows2, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { terminalTheme } from '@/themes/opacity';
import { useActiveTheme } from '@/themes/useActiveTheme';
import { ConnectionBanner } from '@/app/ConnectionStatus';
import type { ConnState } from '@/ipc/ssh';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import type { SshPanel, TerminalPanel } from '@/workspace/types';
import { createTerminal, terminalOptions, type TerminalHandle } from './createTerminal';
import { ExitOverlay } from './ExitOverlay';
import { useKeybindings } from '@/stores/keybindings';
import { clipboardKey, matchShortcut } from './keys';
import { enableLigatures } from './ligatures';
import { parseOsc7 } from './osc7';
import { needsPasteConfirmation, pastedLineCount } from './paste';
import { createResizeScheduler } from './resize';
import { SearchBar } from './SearchBar';
import { registerSession, unregisterSession } from './sessionRegistry';
import { registerTerminalActions } from './terminalActions';

export interface TerminalViewProps {
  tabId: string;
  leafId: string;
  panel: TerminalPanel | SshPanel;
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

const noop = () => undefined;

/**
 * Fits the terminal to its container, unless the container has no size: a pane in a
 * hidden tab (`display: none`) would otherwise be shrunk to a few columns, reflowing
 * and truncating its scrollback and resizing the program inside.
 */
function safeFit(h: TerminalHandle, el: HTMLElement): boolean {
  if (el.clientWidth === 0 || el.clientHeight === 0) return false;
  try {
    h.fit.fit();
    return true;
  } catch {
    return false; // not laid out yet
  }
}

function errorText(err: unknown): string {
  if (isSessionError(err)) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function TerminalView(props: TerminalViewProps) {
  const terminalSettings = useSettings((s) => s.settings?.terminal);
  const activeTheme = useActiveTheme();
  const opacity = useSettings((s) => s.settings?.appearance.window.opacity ?? 1);
  const theme = useMemo(() => terminalTheme(activeTheme, opacity), [activeTheme, opacity]);

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
  const [connection, setConnection] = useState<ConnState | null>(null);
  const dormant = useWorkspace((s) => s.dormant.includes(props.leafId));
  const wake = () => {
    useWorkspace.getState().wake(latest.current.props.leafId);
  };

  const send = (data: string | Uint8Array) => {
    if (useWorkspace.getState().dormant.includes(latest.current.props.leafId)) {
      if (data === '\r') wake();
      return;
    }
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
    const h = createTerminal({ container: el, settings: ts, theme: th });
    handle.current = h;
    setSearchAddon(h.search);
    const { term } = h;

    const scheduler = createResizeScheduler((cols, rows) => {
      const id = session.current?.id;
      if (id != null) resizeSession(id, cols, rows).catch(noop);
    });
    const fitAndResize = () => {
      if (!safeFit(h, el)) return;
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

    const unregisterActions = registerTerminalActions(latest.current.props.leafId, {
      focus: () => {
        term.focus();
      },
      copy: copySelection,
      paste: pasteFromClipboard,
      search: () => {
        setSearchOpen(true);
      },
    });

    term.attachCustomKeyEventHandler((e) => {
      const clip = clipboardKey(e, term.hasSelection());
      if (clip) {
        if (e.type === 'keydown') {
          // Cancels the browser's own paste, which would paste a second time.
          e.preventDefault();
          if (clip === 'copy') {
            copySelection();
            term.clearSelection();
          } else pasteFromClipboard();
        }
        return false;
      }
      const command = matchShortcut(e, useKeybindings.getState().table);
      if (!command) return true;
      if (e.type === 'keydown') {
        if (command === 'terminal.paste') e.preventDefault();
        if (command === 'terminal.copy') copySelection();
        else if (command === 'terminal.paste') pasteFromClipboard();
        else if (command === 'terminal.search') setSearchOpen(true);
      }
      // Every app shortcut is handled by Tilde, never sent to the shell.
      return false;
    });

    return () => {
      unregisterActions();
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

  // Start (or restart) the shell; a restored SSH pane waits until it is woken.
  useEffect(() => {
    const h = handle.current;
    if (!h || dormant) return;
    const s: SessionState = {
      id: null,
      pendingInput: [],
      pendingAck: 0,
      ended: false,
      disposed: false,
    };
    session.current = s;
    // A pane in a background tab has no size yet: keep the default until it is shown.
    if (container.current) safeFit(h, container.current);
    const opened = { cols: h.term.cols, rows: h.term.rows };
    const ack = (bytes: number) => {
      if (s.disposed) return;
      if (s.id === null) s.pendingAck += bytes;
      else ackSession(s.id, bytes).catch(noop);
    };
    const { panel, leafId } = latest.current.props;
    const showState = (state: ConnState) => {
      if (s.disposed) return;
      setConnection(state);
      useSsh.getState().setState(leafId, state);
    };
    if (panel.kind === 'ssh') showState({ kind: 'resolving' });

    openSession({
      target:
        panel.kind === 'ssh'
          ? { kind: 'ssh', target: panel.target, connectionId: panel.connectionId }
          : { kind: 'local', profileId: panel.profileId },
      cwd: panel.kind === 'terminal' ? panel.cwd : null,
      onState: showState,
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
        if (panel.kind === 'ssh') {
          // The banner says why and offers to retry.
          const cancelled = isSessionError(err) && err.kind === 'cancelled';
          showState({ kind: 'failed', message: cancelled ? 'Connexion annulée' : errorText(err) });
          return;
        }
        h.term.write(`\r\n\u001b[31m${errorText(err)}\u001b[0m\r\n`);
        if (isSessionError(err)) latest.current.props.onSessionError(err);
      },
    );

    return () => {
      s.disposed = true;
      useSsh.getState().clear(leafId);
      unregisterSession(latest.current.props.leafId);
      if (s.id !== null && !s.ended) closeSession(s.id).catch(noop);
    };
  }, [generation, dormant]);

  // Ligatures follow the setting live (the terminal is created by an earlier effect).
  const ligatures = terminalSettings?.ligatures ?? false;
  useEffect(() => {
    const h = handle.current;
    if (!h || !ligatures) return;
    return enableLigatures(h.term);
  }, [ligatures]);

  // Live settings and theme updates: no new session, just new options.
  useEffect(() => {
    const h = handle.current;
    if (!h || !terminalSettings) return;
    h.term.options = terminalOptions(terminalSettings, theme);
    if (container.current) safeFit(h, container.current);
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
    setConnection(null);
    setGeneration((g) => g + 1);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={rightClick !== 'menu'}>
          <div
            ref={container}
            className="h-full w-full px-2 pt-1"
            style={{ backgroundColor: theme.background }}
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
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              const ws = useWorkspace.getState();
              ws.focusLeaf(props.tabId, props.leafId);
              ws.splitActive('row');
            }}
          >
            <Columns2 strokeWidth={1.5} /> Diviser à droite
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const ws = useWorkspace.getState();
              ws.focusLeaf(props.tabId, props.leafId);
              ws.splitActive('column');
            }}
          >
            <Rows2 strokeWidth={1.5} /> Diviser en bas
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {searchOpen && searchAddon && (
        <SearchBar
          search={searchAddon}
          theme={activeTheme}
          onClose={() => {
            setSearchOpen(false);
            handle.current?.term.focus();
          }}
        />
      )}

      {props.panel.kind === 'ssh' &&
        (dormant ? (
          <ConnectionBanner
            state={{ kind: 'failed', message: 'Déconnecté — Entrée pour reconnecter' }}
            retryLabel="Se connecter"
            onRetry={wake}
          />
        ) : (
          <ConnectionBanner state={connection} onRetry={restart} />
        ))}

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
