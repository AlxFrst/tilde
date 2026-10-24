import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerBuiltins } from '@/commands/builtin';
import { MAIN_SPACE } from '@/connections/spaces';
import type { Connection, ConnectionsFile } from '@/ipc/connections';
import { upsertConnection } from '@/ipc/connections';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { compileBindings, DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import { Rail } from '../rail/Rail';
import { startSpaceSync } from '../spaceSync';
import { useShortcuts } from '../useShortcuts';
import { LibraryDialog } from './LibraryDialog';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve({ ...c, id: c.id || 'adopted' })),
}));

const pro = { id: 'pro', name: 'Pro', color: '#7AA2F7', icon: 'briefcase' };
const web = blankConnection({ id: 'w', name: 'web-01', host: 'web01.example', spaceId: 'pro' });
const nas = blankConnection({ id: 'n', name: 'nas', host: 'nas.lan' });
const file: ConnectionsFile = {
  version: 1,
  spaces: [MAIN_SPACE, pro],
  folders: [],
  connections: [web, nas],
  recents: [],
};

function Shell() {
  useShortcuts();
  return (
    <>
      <Rail side="left" width={280} onOpenSettings={() => undefined} />
      <LibraryDialog />
    </>
  );
}

const ws = () => useWorkspace.getState();
const library = () => screen.getByRole('dialog', { name: 'Bibliothèque' });
let stop: () => void = () => undefined;
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
  useConnections.setState({
    loaded: true,
    readOnly: false,
    file,
    sshHosts: [
      { alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 },
      { alias: 'backup', hostname: 'backup.internal', user: 'me', port: 22 },
    ],
  });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useKeybindings.setState({
    effective: { ...DEFAULT_KEYBINDINGS },
    table: compileBindings(DEFAULT_KEYBINDINGS),
  });
  useUi.setState({ libraryOpen: false });
  stop = startSpaceSync();
  stopCommands = registerBuiltins();
});
afterEach(() => {
  stop();
  stopCommands();
  setSpaceResolver(defaultSpaceResolver);
});

async function openLibrary() {
  render(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: /Bibliothèque/ }));
  return library();
}

test('the rail button and ctrl+shift+l open it', async () => {
  render(<Shell />);
  fireEvent.keyDown(window, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true });
  expect(library()).toBeInTheDocument();
  act(() => {
    useUi.getState().setLibraryOpen(false);
  });
  await userEvent.click(screen.getByRole('button', { name: /Bibliothèque/ }));
  expect(library()).toBeInTheDocument();
});

test("lists every space's connections grouped by space, and the ~/.ssh/config hosts", async () => {
  const dialog = await openLibrary();
  expect(
    within(within(dialog).getByRole('group', { name: 'Pro' })).getByText('web-01'),
  ).toBeInTheDocument();
  expect(
    within(within(dialog).getByRole('group', { name: 'Principal' })).getByText('nas'),
  ).toBeInTheDocument();
  const hosts = within(dialog).getByRole('group', { name: '~/.ssh/config' });
  expect(within(hosts).getByText('mail')).toBeInTheDocument();
});

test('search filters connections and hosts', async () => {
  const dialog = await openLibrary();
  await userEvent.type(
    within(dialog).getByRole('searchbox', { name: 'Rechercher dans la Bibliothèque' }),
    'web',
  );
  expect(within(dialog).getByText('web-01')).toBeInTheDocument();
  expect(within(dialog).queryByText('nas')).toBeNull();
  expect(within(dialog).queryByText('mail')).toBeNull();
});

test('opening a connection of another space switches to it', async () => {
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ouvrir web-01' }));
  expect(ws().activeSpaceId).toBe('pro');
  expect(ws().tabs[0]?.pinnedConnectionId).toBe('w');
});

test('open here keeps the current space and does not pin', async () => {
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ouvrir web-01 ici' }));
  expect(ws().activeSpaceId).toBe('main');
  const tab = ws().tabs[0];
  expect(tab?.pinnedConnectionId).toBeNull();
  expect(tab && leaves(tab.root)[0]?.panel).toMatchObject({ kind: 'ssh', connectionId: 'w' });
});

test('move to the active space', async () => {
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Déplacer web-01 ici' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'w', spaceId: 'main' }),
  );
  expect(within(dialog).queryByRole('button', { name: 'Déplacer nas ici' })).toBeNull();
});

test('adopting a host saves it in the active space', async () => {
  act(() => {
    ws().switchSpace('pro');
  });
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Adopter mail' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'mail', host: 'mail', spaceId: 'pro' }),
  );
});

test('an ~/.ssh/config host opens from a visible button, and the Library steps aside', async () => {
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ouvrir mail' }));
  expect(useUi.getState().libraryOpen).toBe(false);
  const shown = ws().tabs.find((t) => t.id === ws().activeTabId);
  const ssh = shown && leaves(shown.root)[0]?.panel;
  expect(ssh).toMatchObject({ kind: 'ssh', target: 'mail' });
});

test('hiding a host is a visible button too, and the section folds', async () => {
  const update = vi.fn(() => Promise.resolve());
  useSettings.setState({ update });
  const dialog = await openLibrary();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Masquer backup' }));
  expect(update).toHaveBeenCalledWith({ appearance: { sshConfigHosts: { hidden: ['backup'] } } });
  const hosts = within(dialog).getByRole('group', { name: '~/.ssh/config' });
  await userEvent.click(within(hosts).getByText('~/.ssh/config'));
  expect(within(hosts).queryByText('mail')).toBeNull();
});
