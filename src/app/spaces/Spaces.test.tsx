import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerBuiltins } from '@/commands/builtin';
import { MAIN_SPACE } from '@/connections/spaces';
import type { Connection, ConnectionsFile, Space } from '@/ipc/connections';
import { removeSpace, upsertConnection, upsertFolder, upsertSpace } from '@/ipc/connections';
import type { ResolvedProfile } from '@/ipc/profiles';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useWorkspace } from '@/stores/workspace';
import { compileBindings, DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, setSpaceResolver, spaceOfTab } from '@/workspace/spaces';
import { startSpaceSync } from '../spaceSync';
import { ConfirmDialog } from '../ConfirmDialog';
import { ConnectionDialog } from '../ConnectionDialog';
import { FolderDialog } from '../FolderDialog';
import { Rail } from '../rail/Rail';
import { useShortcuts } from '../useShortcuts';
import { SpaceDialog } from './SpaceDialog';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve(c)),
  upsertFolder: vi.fn((f: { id: string }) => Promise.resolve({ ...f, id: f.id || 'f-new' })),
  upsertSpace: vi.fn((s: Space) => Promise.resolve({ ...s, id: s.id || 'new-space' })),
  removeSpace: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/ipc/session', () => ({ isSessionBusy: vi.fn(() => Promise.resolve(false)) }));

const pro: Space = { id: 'pro', name: 'Pro', color: '#7AA2F7', icon: 'briefcase' };
const profile: ResolvedProfile = {
  id: 'pwsh',
  name: 'PowerShell',
  command: 'pwsh',
  args: [],
  cwd: null,
  env: {},
  icon: 'powershell',
  color: null,
  source: 'detected',
};
const prodConn = blankConnection({ id: 'c1', name: 'prod', host: 'prod', spaceId: 'pro' });

function setFile(file: Partial<ConnectionsFile>) {
  act(() => {
    useConnections.setState({
      loaded: true,
      readOnly: false,
      file: { version: 1, spaces: [], folders: [], connections: [], recents: [], ...file },
    });
  });
}

function Shell() {
  useShortcuts();
  return (
    <>
      <Rail side="left" width={280} onOpenSettings={() => undefined} />
      <SpaceDialog />
      <ConfirmDialog />
      <ConnectionDialog />
      <FolderDialog />
    </>
  );
}

const ws = () => useWorkspace.getState();
const rail = () => screen.getByRole('complementary', { name: 'Barre latérale' });
let stopSync: () => void = () => undefined;
let stopCommands: () => void = () => undefined;

beforeAll(() => {
  registerCorePanels();
});
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useKeybindings.setState({
    effective: { ...DEFAULT_KEYBINDINGS },
    table: compileBindings(DEFAULT_KEYBINDINGS),
  });
  useConnections.setState({ editing: null, editingFolder: null });
  setFile({});
  stopSync = startSpaceSync();
  stopCommands = registerBuiltins();
});
afterEach(() => {
  stopSync();
  stopCommands();
  setSpaceResolver(defaultSpaceResolver);
});

test('one space shows only the new-space button', () => {
  render(<Shell />);
  expect(within(rail()).getByRole('button', { name: 'Nouvel espace' })).toBeInTheDocument();
  expect(within(rail()).queryByRole('group', { name: 'Espaces' })).toBeNull();
});

test('creating a space from the dialog saves it and switches to it', async () => {
  render(<Shell />);
  await userEvent.click(within(rail()).getByRole('button', { name: 'Nouvel espace' }));
  await userEvent.type(screen.getByLabelText('Nom de l’espace'), 'Homelab');
  await userEvent.click(screen.getByRole('radio', { name: 'Vert' }));
  await userEvent.click(screen.getByRole('radio', { name: 'house' }));
  await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
  expect(upsertSpace).toHaveBeenCalledWith({
    id: '',
    name: 'Homelab',
    color: '#9ECE6A',
    icon: 'house',
  });
  expect(ws().activeSpaceId).toBe('new-space');
});

test('clicking a space switches the rail and the shown session', async () => {
  setFile({ spaces: [MAIN_SPACE, pro], connections: [prodConn] });
  const mainTab = ws().openTab('pwsh');
  render(<Shell />);
  const spaces = within(rail()).getByRole('group', { name: 'Espaces' });
  await userEvent.click(within(spaces).getByRole('button', { name: /Pro/ }));
  expect(ws().activeSpaceId).toBe('pro');
  expect(ws().activeTabId).toBeNull();
  expect(within(rail()).getByRole('button', { name: /^prod/ })).toBeInTheDocument();
  await userEvent.click(within(spaces).getByRole('button', { name: /Principal/ }));
  expect(ws().activeTabId).toBe(mainTab);
});

test('ctrl+shift+2 switches to the second space', () => {
  setFile({ spaces: [MAIN_SPACE, pro] });
  render(<Shell />);
  fireEvent.keyDown(window, { key: '2', code: 'Digit2', ctrlKey: true, shiftKey: true });
  expect(ws().activeSpaceId).toBe('pro');
  fireEvent.keyDown(window, { key: 'PageUp', code: 'PageUp', ctrlKey: true, shiftKey: true });
  expect(ws().activeSpaceId).toBe('main');
});

test('moving a pinned session moves its connection', async () => {
  setFile({ spaces: [MAIN_SPACE, pro], connections: [prodConn] });
  ws().openPinned('c1', 'prod', 'pro');
  render(<Shell />);
  fireEvent.contextMenu(within(rail()).getByRole('button', { name: /^prod/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Déplacer vers l’espace' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Principal' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'c1', spaceId: 'main' }),
  );
});

test('moving a today session moves only the session', async () => {
  setFile({ spaces: [MAIN_SPACE, pro] });
  const t = ws().openTab('pwsh');
  render(<Shell />);
  fireEvent.contextMenu(within(rail()).getByRole('button', { name: /^PowerShell/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Déplacer vers l’espace' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pro' }));
  const tab = ws().tabs.find((x) => x.id === t);
  expect(tab && spaceOfTab(tab)).toBe('pro');
  expect(upsertConnection).not.toHaveBeenCalled();
});

test('deleting the active space with a live ssh session keeps it in the first space', async () => {
  setFile({ spaces: [MAIN_SPACE, pro], connections: [prodConn] });
  const t = ws().openPinned('c1', 'prod', 'pro');
  render(<Shell />);
  const spaces = within(rail()).getByRole('group', { name: 'Espaces' });
  fireEvent.contextMenu(within(spaces).getByRole('button', { name: /Pro/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Supprimer l’espace…' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('1 connexion');
  expect(dialog).toHaveTextContent('1 session');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
  expect(removeSpace).toHaveBeenCalledWith('pro');
  // The backend moved the connection to Principal and dropped the space.
  setFile({ spaces: [MAIN_SPACE], connections: [{ ...prodConn, spaceId: 'main' }] });
  expect(ws().tabs.map((x) => x.id)).toEqual([t]);
  expect(ws().activeSpaceId).toBe('main');
  expect(ws().activeTabId).toBe(t);
});

test('the connection and folder dialogs offer the space when there are several', async () => {
  setFile({ spaces: [MAIN_SPACE, pro] });
  render(<Shell />);
  act(() => {
    useConnections.getState().setEditing(blankConnection({ spaceId: 'main' }));
  });
  await userEvent.selectOptions(screen.getByLabelText('Espace'), 'pro');
  await userEvent.type(screen.getByLabelText('Nom'), 'x');
  await userEvent.type(screen.getByLabelText('Hôte'), 'x.example');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(upsertConnection).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'pro' }));

  act(() => {
    ws().switchSpace('pro');
    useConnections.getState().setEditingFolder('new');
  });
  expect(screen.getByLabelText('Espace du dossier')).toHaveValue('pro');
  await userEvent.type(screen.getByLabelText('Nom du dossier'), 'Lab');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(upsertFolder).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Lab', spaceId: 'pro' }),
  );
});

test('the rail takes the space colour', () => {
  setFile({ spaces: [MAIN_SPACE, pro] });
  act(() => {
    ws().switchSpace('pro');
  });
  render(<Shell />);
  expect(rail().style.getPropertyValue('--tilde-space')).toBe('#7AA2F7');
});
