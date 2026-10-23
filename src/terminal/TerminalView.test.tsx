/* eslint-disable @typescript-eslint/no-extraneous-class -- stand-ins for xterm addons */
import { act, render } from '@testing-library/react';
import type { OpenSessionOptions } from '@/ipc/session';
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
    open() {}
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
    attachCustomKeyEventHandler() {}
    focus() {}
    reset() {}
    paste() {}
    hasSelection() {
      return false;
    }
    getSelection() {
      return '';
    }
    dispose() {
      this.disposed = true;
    }
    type(text: string) {
      this.dataListeners.forEach((l) => {
        l(text);
      });
    }
    clearSelection() {}
  }
  return { FakeTerminal };
});
type FakeTerminal = InstanceType<typeof FakeTerminal>;

const webglShouldThrow = vi.hoisted(() => ({ value: false }));

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
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
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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

function renderView() {
  const props = {
    tabId: 't',
    leafId: 'l',
    panel,
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
    expect.objectContaining({ profileId: 'cmd', cwd: 'C:\\x', cols: 80, rows: 24 }),
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
