import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedProfile } from '@/ipc/profiles';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { leaves } from '@/workspace/tree';
import { TabBar } from './TabBar';

vi.mock('@/ipc/session', () => ({ isSessionBusy: vi.fn(() => Promise.resolve(false)) }));

const profile = (id: string, name: string, icon = 'terminal'): ResolvedProfile => ({
  id,
  name,
  command: id,
  args: [],
  cwd: null,
  env: {},
  icon,
  color: null,
  source: 'detected',
});

const ws = () => useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState({ tabs: [], activeTabId: null });
  useProfiles.setState({
    profiles: [
      profile('cmd', 'Invite de commandes', 'cmd'),
      profile('wsl:Ubuntu', 'Ubuntu (WSL)', 'linux'),
    ],
    loaded: true,
  });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
});

test('renders tabs with resolved titles', () => {
  const a = ws().openTab('cmd');
  const b = ws().openTab('wsl:Ubuntu');
  const c = ws().openTab('cmd');
  ws().renameTab(b, 'prod');
  const leafC = ws().tabs[2]?.activeLeafId ?? '';
  ws().updatePanel(c, leafC, { title: 'vim notes.md' });
  render(<TabBar />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(['Invite de commandes', 'prod', 'vim notes.md']);
  expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
  expect(a).toBeTruthy();
});

test('double click renames, empty restores default', async () => {
  const user = userEvent.setup();
  ws().openTab('cmd');
  render(<TabBar />);
  await user.dblClick(screen.getByRole('tab'));
  const input = screen.getByRole('textbox', { name: 'Nom de l’onglet' });
  await user.clear(input);
  await user.type(input, 'serveur{Enter}');
  expect(ws().tabs[0]?.customTitle).toBe('serveur');
  await user.dblClick(screen.getByRole('tab'));
  await user.clear(screen.getByRole('textbox', { name: 'Nom de l’onglet' }));
  await user.keyboard('{Enter}');
  expect(ws().tabs[0]?.customTitle).toBeNull();
});

test('middle click closes', async () => {
  ws().openTab('cmd');
  ws().openTab('cmd');
  render(<TabBar />);
  fireEvent(
    screen.getAllByRole('tab')[0] as HTMLElement,
    new MouseEvent('auxclick', { bubbles: true, button: 1 }),
  );
  await vi.waitFor(() => {
    expect(ws().tabs).toHaveLength(1);
  });
});

test('+ opens default profile', async () => {
  const user = userEvent.setup();
  useSettings.setState({
    settings: {
      ...defaultSettings,
      terminal: { ...defaultSettings.terminal, defaultProfile: 'wsl:Ubuntu' },
    },
  });
  render(<TabBar />);
  await user.click(screen.getByRole('button', { name: 'Nouvel onglet' }));
  const t = ws().tabs[0];
  if (!t) throw new Error('no tab opened');
  expect(leaves(t.root)[0]?.panel).toMatchObject({ profileId: 'wsl:Ubuntu' });
});

test('new tab menu lists profiles', async () => {
  const user = userEvent.setup();
  render(<TabBar />);
  await user.click(screen.getByRole('button', { name: 'Choisir un profil' }));
  await user.click(await screen.findByRole('menuitem', { name: /Ubuntu \(WSL\)/ }));
  const tab = ws().tabs[0];
  if (!tab) throw new Error('no tab opened');
  expect(leaves(tab.root)[0]?.panel).toMatchObject({ profileId: 'wsl:Ubuntu' });
});

test('ssh state events update the tab status', async () => {
  const { useSsh } = await import('@/stores/ssh');
  ws().openSshTab('prod');
  const leafId = ws().tabs[0]?.activeLeafId ?? '';
  render(<TabBar />);
  expect(screen.getByRole('tab').textContent).toBe('prod');
  act(() => {
    useSsh.getState().setState(leafId, { kind: 'reconnecting', attempt: 1, inSecs: 2 });
  });
  expect(screen.getByRole('status', { name: 'Connexion en cours' })).toBeInTheDocument();
  act(() => {
    useSsh.getState().setState(leafId, { kind: 'ready' });
  });
  expect(screen.getByRole('status', { name: 'Connecté' })).toBeInTheDocument();
});

test('an ssh tab opened from a saved connection shows its name', async () => {
  const { useConnections } = await import('@/stores/connections');
  useConnections.setState({
    file: {
      version: 1,
      folders: [],
      recents: [],
      connections: [
        {
          id: 'c1',
          name: 'Base de prod',
          host: 'db.example',
          port: null,
          user: null,
          identityFile: null,
          proxyJump: null,
          forwardAgent: null,
          folderId: null,
          color: null,
          icon: null,
          tags: [],
          favorite: false,
        },
      ],
    },
  });
  ws().openSshTab('db.example', 'c1');
  ws().openSshTab('db.example', 'deleted');
  render(<TabBar />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
    'Base de prod',
    'db.example',
  ]);
});

test('an ssh pane shows a button that shows and hides its files', async () => {
  ws().openTab('cmd');
  render(<TabBar />);
  expect(screen.queryByRole('button', { name: 'Fichiers' })).not.toBeInTheDocument();

  act(() => {
    ws().openSshTab('prod');
  });
  const files = screen.getByRole('button', { name: 'Fichiers' });
  expect(files).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(files);
  expect(screen.getByRole('button', { name: 'Fichiers' })).toHaveAttribute('aria-pressed', 'true');
  const kinds = () => ws().tabs.flatMap((t) => leaves(t.root).map((l) => l.panel.kind));
  expect(kinds()).toEqual(['terminal', 'ssh', 'sftp']);

  // Still there with the files focused, and it closes them.
  await userEvent.click(screen.getByRole('button', { name: 'Fichiers' }));
  expect(kinds()).toEqual(['terminal', 'ssh']);

  expect(screen.queryByRole('button', { name: 'Moniteur du serveur' })).toBeNull();
});

test('a tab showing the files or the monitor of a connection is named after it', () => {
  act(() => {
    ws().openSshTab('prod.example');
  });
  const sshLeaf = ws().tabs[0]?.activeLeafId ?? '';
  render(<TabBar />);
  act(() => {
    ws().toggleRemoteMonitor(sshLeaf);
  });
  expect(screen.getByRole('tab', { name: /prod\.example/ })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /Moniteur/ })).toBeNull();
});
