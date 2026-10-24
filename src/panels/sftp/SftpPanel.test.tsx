import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/app/ConfirmDialog';
import type { RemoteEntry } from '@/ipc/sftp';
import { sftpCreateFile, sftpList, sftpRemove } from '@/ipc/sftp';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { registerSession, unregisterSession } from '@/terminal/sessionRegistry';
import { findLeaf, leaves } from '@/workspace/tree';
import { SftpPanelView } from './SftpPanel';

const tree: Record<string, RemoteEntry[]> = {
  '/home/me': [
    { name: 'src', path: '/home/me/src', kind: 'dir', size: 0, modified: 1, permissions: 0o755 },
    {
      name: 'a.txt',
      path: '/home/me/a.txt',
      kind: 'file',
      size: 10,
      modified: 1,
      permissions: 0o644,
    },
    {
      name: 'current',
      path: '/home/me/current',
      kind: 'symlink',
      size: 0,
      modified: 1,
      permissions: 0o777,
    },
  ],
  '/home/me/src': [
    {
      name: 'main.rs',
      path: '/home/me/src/main.rs',
      kind: 'file',
      size: 5,
      modified: 1,
      permissions: 0o644,
    },
  ],
  '/var/log': [],
};

vi.mock('@/ipc/sftp', async (orig) => ({
  ...(await orig<typeof import('@/ipc/sftp')>()),
  sftpHome: vi.fn(() => Promise.resolve('/home/me')),
  sftpList: vi.fn((_s: number, path: string) => Promise.resolve(tree[path] ?? [])),
  sftpRemove: vi.fn(() => Promise.resolve(1)),
  sftpCreateFile: vi.fn(() => Promise.resolve()),
  onTransfer: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }),
}));

let tabId = '';
let sshLeaf = '';

function sftpLeaf() {
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
  const leaf = tab && leaves(tab.root).find((l) => l.panel.kind === 'sftp');
  if (!leaf || leaf.panel.kind !== 'sftp') throw new Error('no sftp pane');
  return { id: leaf.id, panel: leaf.panel };
}

function View() {
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === tabId));
  const leaf = tab && leaves(tab.root).find((l) => l.panel.kind === 'sftp');
  if (!leaf || leaf.panel.kind !== 'sftp') return null;
  return <SftpPanelView tabId={tabId} leafId={leaf.id} panel={leaf.panel} active />;
}

beforeEach(() => {
  vi.mocked(sftpList).mockClear();
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  tabId = useWorkspace.getState().openSshTab('prod');
  sshLeaf = useWorkspace.getState().tabs[0]?.activeLeafId ?? '';
  useWorkspace.getState().openSftpBeside(sshLeaf);
  registerSession(sshLeaf, 4);
  useSsh.setState({ states: { [sshLeaf]: { kind: 'ready' } } });
});

afterEach(() => {
  unregisterSession(sshLeaf);
  vi.useRealTimers();
});

test('double click enters a directory and backspace goes up', async () => {
  render(<View />);
  await userEvent.click(screen.getByRole('button', { name: 'Ne pas suivre le terminal' }));
  const src = await screen.findByRole('row', { name: /src/ });
  await userEvent.dblClick(src);
  expect(await screen.findByRole('row', { name: /main\.rs/ })).toBeInTheDocument();
  expect(sftpLeaf().panel.path).toBe('/home/me/src');

  screen.getByRole('row', { name: /main\.rs/ }).focus();
  await userEvent.keyboard('{Backspace}');
  await screen.findByRole('row', { name: /a\.txt/ });
  expect(sftpLeaf().panel.path).toBe('/home/me');
});

test('follow mode tracks the linked terminal cwd', async () => {
  render(<View />);
  await screen.findByRole('row', { name: /a\.txt/ });
  act(() => {
    useWorkspace.getState().updatePanel(tabId, sshLeaf, { cwd: '/var/log' });
  });
  await waitFor(() => {
    expect(sftpLeaf().panel.path).toBe('/var/log');
  });
  expect(screen.getByText('Dossier vide')).toBeInTheDocument();
});

test('without osc7 a snippet is offered', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<View />);
  expect(screen.queryByText(/ne signale pas son dossier/)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(screen.getByText(/ne signale pas son dossier/)).toBeInTheDocument();
  expect(screen.getByText(/PROMPT_COMMAND/)).toBeInTheDocument();
});

test('delete asks for confirmation', async () => {
  render(
    <>
      <View />
      <ConfirmDialog />
    </>,
  );
  const row = await screen.findByRole('row', { name: /src/ });
  fireEvent.contextMenu(row);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));
  expect(sftpRemove).not.toHaveBeenCalled();
  expect(await screen.findByText(/et tout son contenu/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(sftpRemove).toHaveBeenCalledWith(4, '/home/me/src');
});

test('a pane whose ssh session is gone says so', () => {
  unregisterSession(sshLeaf);
  render(<View />);
  expect(screen.getByText(/Déconnecté/)).toBeInTheDocument();
  const tab = useWorkspace.getState().tabs[0];
  expect(tab && findLeaf(tab.root, sshLeaf)).not.toBeNull();
});

test('permissions are never changed through a symbolic link', async () => {
  render(<View />);
  fireEvent.contextMenu(await screen.findByRole('row', { name: /current/ }));
  await screen.findByRole('menuitem', { name: 'Supprimer' });
  expect(screen.queryByRole('menuitem', { name: 'Permissions…' })).toBeNull();
});

test('Modifier opens the built-in editor when editorMode is builtin', async () => {
  const { useSettings } = await import('@/stores/settings');
  const { defaultSettings } = await import('@/test/fixtures');
  useSettings.setState({
    settings: { ...defaultSettings, sftp: { ...defaultSettings.sftp, editorMode: 'builtin' } },
  });
  render(<View />);
  const row = await screen.findByRole('row', { name: /a\.txt/ });
  fireEvent.contextMenu(row);
  await userEvent.click(await screen.findByRole('menuitem', { name: /Modifier/ }));
  const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
  const editor = tab && leaves(tab.root).find((l) => l.panel.kind === 'editor');
  expect(editor?.panel).toMatchObject({
    kind: 'editor',
    source: { kind: 'remote', linkedLeafId: sshLeaf, path: '/home/me/a.txt' },
  });
  useSettings.setState({ settings: defaultSettings });
});

test('Nouveau fichier creates an empty file and opens it in the editor', async () => {
  const { useSettings } = await import('@/stores/settings');
  const { defaultSettings } = await import('@/test/fixtures');
  useSettings.setState({
    settings: { ...defaultSettings, sftp: { ...defaultSettings.sftp, editorMode: 'builtin' } },
  });
  render(<View />);
  await screen.findByRole('row', { name: /a\.txt/ });
  await userEvent.click(screen.getByRole('button', { name: 'Nouveau fichier' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Nom' }), 'notes.md{Enter}');
  expect(sftpCreateFile).toHaveBeenCalledWith(4, '/home/me/notes.md');
  await waitFor(() => {
    const tab = useWorkspace.getState().tabs.find((t) => t.id === tabId);
    const editor = tab && leaves(tab.root).find((l) => l.panel.kind === 'editor');
    expect(editor?.panel).toMatchObject({
      source: { kind: 'remote', linkedLeafId: sshLeaf, path: '/home/me/notes.md' },
    });
  });
  useSettings.setState({ settings: defaultSettings });
});

test('a new file never takes the name of an existing entry', async () => {
  vi.mocked(sftpCreateFile).mockClear();
  render(<View />);
  await screen.findByRole('row', { name: /a\.txt/ });
  await userEvent.click(screen.getByRole('button', { name: 'Nouveau fichier' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Nom' }), 'a.txt{Enter}');
  expect(sftpCreateFile).not.toHaveBeenCalled();
});
