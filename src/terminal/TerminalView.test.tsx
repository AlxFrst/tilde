/* eslint-disable @typescript-eslint/no-extraneous-class -- stand-ins for xterm addons */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpenSessionOptions } from '@/ipc/session';
import type { SshPanel, TerminalPanel } from '@/workspace/types';
import { useSettings } from '@/stores/settings';
import { defaultSettings } from '@/test/fixtures';
import { TerminalView } from './TerminalView';

// ---- fake xterm -------------------------------------------------------------------

type Listener<T> = (v: T) => void;

const { FakeTerminal } = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    unicode = { activeVersion: '6' };
    modes = { bracketedPasteMode: false };
    written: { data: string | Uint8Array; cb?: () => void }[] = [];
    dataListeners: Listener<string>[] = [];
    loaded: unknown[] = [];
    disposed = false;
    parser = { registerOscHandler: vi.fn(() => ({ dispose() {} })) };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      FakeTerminal.instances.push(this);
    }
    loadAddon(a: { activate?: (t: unknown) => void }) {
      this.loaded.push(a);
    }
    container: HTMLElement | null = null;
    open(el: HTMLElement) {
      this.container = el;
    }
    write(data: string | Uint8Array, cb?: () => void) {
      this.written.push({ data, cb });
    }
    onData(l: Listener<string>) {
      this.dataListeners.push(l);
      return { dispose() {} };
    }
    onBinary() {
      return { dispose() {} };
    }
    onTitleChange() {
      return { dispose() {} };
    }
    onSelectionChange() {
      return { dispose() {} };
    }
    keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
    attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean) {
      this.keyHandler = h;
    }
    selection = '';
    joiners = 0;
    registerCharacterJoiner() {
      this.joiners++;
      return this.joiners;
    }
    deregisterCharacterJoiner() {
      this.joiners--;
    }
    focus() {}
    reset() {}
    paste() {}
    hasSelection() {
      return this.selection !== '';
    }
    getSelection() {
      return this.selection;
    }
    dispose() {
      this.disposed = true;
    }
    type(text: string) {
      this.dataListeners.forEach((l) => {
        l(text);
      });
    }
    clearSelection() {
      this.selection = '';
    }
  }
  return { FakeTerminal };
});
type FakeTerminal = InstanceType<typeof FakeTerminal>;

const webglShouldThrow = vi.hoisted(() => ({ value: false }));
const fitCalls = vi.hoisted(() => ({ count: 0 }));
const observers: (() => void)[] = [];

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      fitCalls.count += 1;
    }
  },
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      if (webglShouldThrow.value) throw new Error('no webgl');
    }
    onContextLoss() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext() {
      return true;
    }
    findPrevious() {
      return true;
    }
    clearDecorations() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-serialize', () => ({ SerializeAddon: class {} }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(() => Promise.resolve('')),
  writeText: vi.fn(() => Promise.resolve()),
}));

// ---- fake session IPC ----------------------------------------------------------------

const ipc = vi.hoisted(() => ({
  open: null as OpenSessionOptions | null,
  resolveOpen: null as ((v: { id: number; profileId: string }) => void) | null,
}));

vi.mock('@/ipc/session', () => ({
  openSession: vi.fn((o: OpenSessionOptions) => {
    ipc.open = o;
    return new Promise((resolve) => {
      ipc.resolveOpen = resolve;
    });
  }),
  writeSession: vi.fn(() => Promise.resolve()),
  ackSession: vi.fn(() => Promise.resolve()),
  resizeSession: vi.fn(() => Promise.resolve()),
  closeSession: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn(() => Promise.resolve()),
  isSessionError: () => false,
}));

const session = await import('@/ipc/session');

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('dark'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      observers.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  FakeTerminal.instances = [];
  webglShouldThrow.value = false;
  ipc.open = null;
  ipc.resolveOpen = null;
  vi.clearAllMocks();
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
});

const panel = { kind: 'terminal' as const, profileId: 'cmd', cwd: 'C:\\x', title: null };

function renderView(p: TerminalPanel | SshPanel = panel) {
  const props = {
    tabId: 't',
    leafId: 'l',
    panel: p,
    active: true,
    onExit: vi.fn(),
    onTitle: vi.fn(),
    onCwd: vi.fn(),
    onSessionError: vi.fn(),
    onClose: vi.fn(),
  };
  const utils = render(<TerminalView {...props} />);
  const term = FakeTerminal.instances[0];
  if (!term) throw new Error('no terminal created');
  return { ...utils, props, term };
}

async function resolveSession(id = 9) {
  await act(async () => {
    ipc.resolveOpen?.({ id, profileId: 'cmd' });
    await Promise.resolve();
  });
}

// ---- tests ---------------------------------------------------------------------------

test('opens a session with the fitted size and acks written data', async () => {
  const { term } = renderView();
  expect(session.openSession).toHaveBeenCalledWith(
    expect.objectContaining({
      target: { kind: 'local', profileId: 'cmd' },
      cwd: 'C:\\x',
      cols: 80,
      rows: 24,
    }),
  );
  await resolveSession(9);
  act(() => {
    ipc.open?.onData(new Uint8Array([1, 2, 3]));
  });
  const last = term.written.at(-1);
  expect(last?.data).toEqual(new Uint8Array([1, 2, 3]));
  expect(session.ackSession).not.toHaveBeenCalled();
  last?.cb?.();
  expect(session.ackSession).toHaveBeenCalledWith(9, 3);
});

test('keyboard input is written to the session', async () => {
  const { term } = renderView();
  await resolveSession(4);
  term.type('ls\r');
  expect(session.writeSession).toHaveBeenCalledWith(4, 'ls\r');
});

test('input and acks before the session id is known are queued, then flushed', async () => {
  const { term } = renderView();
  // ConPTY asks for the cursor position before session_open has returned.
  act(() => {
    ipc.open?.onData(new Uint8Array([27, 91, 54, 110]));
  });
  term.written.at(-1)?.cb?.();
  term.type('\u001b[1;1R');
  expect(session.writeSession).not.toHaveBeenCalled();
  expect(session.ackSession).not.toHaveBeenCalled();
  await resolveSession(5);
  expect(session.writeSession).toHaveBeenCalledWith(5, '\u001b[1;1R');
  expect(session.ackSession).toHaveBeenCalledWith(5, 4);
});

test('unicode 11 is active', () => {
  const { term } = renderView();
  expect(term.unicode.activeVersion).toBe('11');
});

test('theme change updates options without reopening the session', async () => {
  const { term } = renderView();
  await resolveSession();
  act(() => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        appearance: { ...defaultSettings.appearance, colorScheme: 'light' },
        terminal: { ...defaultSettings.terminal, fontSize: 18 },
      },
    });
  });
  expect(term.options.fontSize).toBe(18);
  expect((term.options.theme as { background: string }).background).toBe('#F7F8FB');
  expect(session.openSession).toHaveBeenCalledTimes(1);
});

test('ligatures follow the setting live', async () => {
  const { term } = renderView();
  await resolveSession();
  expect(term.joiners).toBe(1);
  act(() => {
    useSettings.setState({
      settings: { ...defaultSettings, terminal: { ...defaultSettings.terminal, ligatures: false } },
    });
  });
  expect(term.joiners).toBe(0);
});

test('unmount closes the session', async () => {
  const { unmount, term } = renderView();
  await resolveSession(3);
  unmount();
  expect(session.closeSession).toHaveBeenCalledWith(3);
  expect(term.disposed).toBe(true);
});

test('webgl failure falls back without crashing', () => {
  webglShouldThrow.value = true;
  const { term } = renderView();
  expect(session.openSession).toHaveBeenCalled();
  expect(term.disposed).toBe(false);
});

test('exit is reported and shows the exit overlay', async () => {
  const { props, findByText } = renderView();
  await resolveSession();
  act(() => {
    ipc.open?.onExit(3);
  });
  expect(props.onExit).toHaveBeenCalledWith(3);
  expect(await findByText(/Processus terminé \(code 3\)/)).toBeInTheDocument();
});

function sizeOf(el: HTMLElement | null, width: number, height: number) {
  if (!el) throw new Error('terminal not opened');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
}

test('a hidden pane (zero size) is never refitted', async () => {
  const { term } = renderView();
  await resolveSession();
  fitCalls.count = 0;
  sizeOf(term.container, 0, 0); // display:none (background tab)
  act(() => {
    observers.forEach((cb) => {
      cb();
    });
  });
  expect(fitCalls.count).toBe(0);
  sizeOf(term.container, 800, 600);
  act(() => {
    observers.forEach((cb) => {
      cb();
    });
  });
  expect(fitCalls.count).toBeGreaterThan(0);
});

test('an ssh pane shows its connection progress and offers to retry a failure', () => {
  renderView({ kind: 'ssh', target: 'prod', connectionId: null, cwd: null, title: null });
  expect(session.openSession).toHaveBeenCalledWith(
    expect.objectContaining({ target: { kind: 'ssh', target: 'prod', connectionId: null } }),
  );
  act(() => {
    ipc.open?.onState?.({ kind: 'connecting', hop: 'bastion 1/2 (b1)' });
  });
  expect(screen.getByText('Connexion à bastion 1/2 (b1)…')).toBeInTheDocument();
  act(() => {
    ipc.open?.onState?.({ kind: 'failed', message: 'authentification refusée' });
  });
  expect(screen.getByText('authentification refusée')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(session.openSession).toHaveBeenCalledTimes(2);
});

test('a restored ssh pane waits for Enter before connecting', async () => {
  const { useWorkspace } = await import('@/stores/workspace');
  useWorkspace.setState({ dormant: ['l'] });
  const { term } = renderView({
    kind: 'ssh',
    target: 'prod',
    connectionId: null,
    cwd: null,
    title: null,
  });
  expect(session.openSession).not.toHaveBeenCalled();
  expect(screen.getByText(/Déconnecté — Entrée pour reconnecter/)).toBeInTheDocument();
  act(() => {
    term.type('x');
  });
  expect(session.openSession).not.toHaveBeenCalled();
  act(() => {
    term.type('\r');
  });
  expect(session.openSession).toHaveBeenCalledTimes(1);
  expect(useWorkspace.getState().dormant).toEqual([]);
});

test('Ctrl+C copies a selection, Ctrl+V pastes, and Ctrl+C alone still reaches the shell', async () => {
  const { readText, writeText } = await import('@tauri-apps/plugin-clipboard-manager');
  vi.mocked(readText).mockResolvedValueOnce('echo hi');
  const { term } = renderView();
  const paste = vi.spyOn(term, 'paste');
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', {
      key,
      code: `Key${key.toUpperCase()}`,
      ctrlKey: true,
      cancelable: true,
    });
    return { handled: term.keyHandler?.(e) === false, prevented: e.defaultPrevented };
  };

  term.selection = 'some text';
  expect(press('c')).toEqual({ handled: true, prevented: true });
  expect(writeText).toHaveBeenCalledWith('some text');
  expect(term.hasSelection()).toBe(false);

  expect(press('c').handled).toBe(false);

  // The browser's own paste is cancelled so the text is never pasted twice.
  expect(press('v')).toEqual({ handled: true, prevented: true });
  await act(async () => {
    await Promise.resolve();
  });
  expect(paste).toHaveBeenCalledWith('echo hi');
});

test('the terminal menu splits the pane', async () => {
  const splitActive = vi.fn();
  const focusLeaf = vi.fn();
  const { useWorkspace } = await import('@/stores/workspace');
  useWorkspace.setState({ splitActive, focusLeaf });
  const { container } = renderView();
  const surface = container.querySelector('.h-full.w-full.px-2') as HTMLElement;
  fireEvent.contextMenu(surface);
  await userEvent.click(await screen.findByRole('menuitem', { name: /Diviser à droite/ }));
  expect(focusLeaf).toHaveBeenCalledWith('t', 'l');
  expect(splitActive).toHaveBeenCalledWith('row');
  fireEvent.contextMenu(surface);
  await userEvent.click(await screen.findByRole('menuitem', { name: /Diviser en bas/ }));
  expect(splitActive).toHaveBeenLastCalledWith('column');
});
