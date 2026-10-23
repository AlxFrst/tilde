import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { closePane } from '@/app/actions';
import { ConfirmCloseDialog } from '@/app/ConfirmCloseDialog';
import { editorOpenRemote, editorSaveRemote } from '@/ipc/editor';
import { useEditors } from '@/stores/editors';
import { useWorkspace } from '@/stores/workspace';
import { registerSession } from '@/terminal/sessionRegistry';
import type { EditorPanel } from '@/workspace/types';
import EditorPane from './EditorPane';

// CodeMirror needs layout APIs jsdom lacks: a textarea stands in for it.
vi.mock('./codemirror', () => ({
  createEditor: (opts: {
    parent: HTMLElement;
    doc: string;
    onChange: (t: string) => void;
    onSave: () => void;
  }) => {
    const area = document.createElement('textarea');
    area.setAttribute('aria-label', 'Contenu');
    area.value = opts.doc;
    area.addEventListener('input', () => {
      opts.onChange(area.value);
    });
    area.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') opts.onSave();
    });
    opts.parent.append(area);
    return {
      view: { focus: () => undefined },
      setDoc: (t: string) => {
        area.value = t;
      },
      setTheme: () => undefined,
      setLanguage: () => undefined,
      destroy: () => {
        area.remove();
      },
    };
  },
}));
vi.mock('@/ipc/editor', async (orig) => ({
  ...(await orig<typeof import('@/ipc/editor')>()),
  editorOpenRemote: vi.fn(),
  editorSaveRemote: vi.fn(),
}));
vi.mock('@/ipc/session', async (orig) => ({
  ...(await orig<typeof import('@/ipc/session')>()),
  isSessionBusy: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const state: EditorPanel = {
  kind: 'editor',
  source: { kind: 'remote', linkedLeafId: 'ssh-1', path: '/srv/app/config.yml' },
  cwd: null,
  title: null,
};

function Pane() {
  return (
    <EditorPane tabId="t1" leafId="ed-1" state={state} active update={vi.fn()} close={vi.fn()} />
  );
}

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

beforeEach(() => {
  vi.clearAllMocks();
  useEditors.setState({ docs: {} });
  registerSession('ssh-1', 4);
});

test('a binary file shows a message instead of the editor', async () => {
  vi.mocked(editorOpenRemote).mockRejectedValue({
    kind: 'binary',
    message: "fichier binaire ou non UTF-8 : ouvrez-le avec l'éditeur externe",
  });
  render(<Pane />);
  expect(await screen.findByText(/fichier binaire/)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /éditeur externe/ }).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('Contenu')).toBeNull();
});

test('Ctrl+S saves and clears the dirty mark', async () => {
  vi.mocked(editorOpenRemote).mockResolvedValue({ text: 'a: 1\n', stamp: { size: 5, mtime: 1 } });
  vi.mocked(editorSaveRemote).mockResolvedValue({ size: 5, mtime: 2 });
  render(<Pane />);
  const area = await screen.findByLabelText('Contenu');
  fireEvent.input(area, { target: { value: 'a: 2\n' } });
  await waitFor(() => {
    expect(useEditors.getState().docs['ed-1']?.dirty).toBe(true);
  });
  expect(screen.getByLabelText('Modifié')).toBeInTheDocument();
  fireEvent.keyDown(area, { key: 's', ctrlKey: true });
  await waitFor(() => {
    expect(editorSaveRemote).toHaveBeenCalledWith(
      4,
      '/srv/app/config.yml',
      'a: 2\n',
      { size: 5, mtime: 1 },
      false,
    );
  });
  await waitFor(() => {
    expect(useEditors.getState().docs['ed-1']?.dirty).toBe(false);
  });
});

test('a conflict shows a banner offering to overwrite or reload', async () => {
  vi.mocked(editorOpenRemote).mockResolvedValue({ text: 'x\n', stamp: { size: 2, mtime: 1 } });
  vi.mocked(editorSaveRemote)
    .mockRejectedValueOnce({ kind: 'conflict', message: 'changé', current: { size: 9, mtime: 3 } })
    .mockResolvedValueOnce({ size: 2, mtime: 4 });
  render(<Pane />);
  const area = await screen.findByLabelText('Contenu');
  fireEvent.input(area, { target: { value: 'y\n' } });
  fireEvent.keyDown(area, { key: 's', ctrlKey: true });
  expect(await screen.findByText(/a changé sur le serveur/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Écraser' }));
  await waitFor(() => {
    expect(editorSaveRemote).toHaveBeenLastCalledWith(
      4,
      '/srv/app/config.yml',
      'y\n',
      { size: 2, mtime: 1 },
      true,
    );
  });
});

test('closing a dirty editor asks first', async () => {
  useWorkspace.setState({
    tabs: [
      {
        id: 't1',
        customTitle: null,
        color: null,
        activeLeafId: 'ed-1',
        root: { type: 'leaf', id: 'ed-1', panel: state },
      },
    ],
    activeTabId: 't1',
  });
  useEditors.setState({ docs: { 'ed-1': { name: 'config.yml', dirty: true, text: 'z' } } });
  render(<ConfirmCloseDialog />);
  let closed = false;
  act(() => {
    void closePane('t1', 'ed-1').then(() => {
      closed = true;
    });
  });
  expect(
    await screen.findByText(/Modifications non enregistrées dans config\.yml/),
  ).toBeInTheDocument();
  expect(useWorkspace.getState().tabs).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  await waitFor(() => {
    expect(closed).toBe(true);
  });
  expect(useWorkspace.getState().tabs).toHaveLength(0);
});
