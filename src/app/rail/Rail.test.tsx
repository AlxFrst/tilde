import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAIN_SPACE } from '@/connections/spaces';
import type { Connection, ConnectionsFile } from '@/ipc/connections';
import { removeConnection } from '@/ipc/connections';
import type { ResolvedProfile } from '@/ipc/profiles';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import { ConfirmCloseDialog } from '../ConfirmCloseDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Rail } from './Rail';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve({ ...c, id: c.id || 'new' })),
  removeConnection: vi.fn(() => Promise.resolve()),
  setFavorite: vi.fn(() => Promise.resolve()),
  openConnectionsFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/ipc/session', () => ({ isSessionBusy: vi.fn(() => Promise.resolve(false)) }));

const pro = { id: 'pro', name: 'Pro', color: '#7AA2F7', icon: 'briefcase' };
const conn = (id: string, name: string, extra: Partial<Connection> = {}) =>
  blankConnection({ id, name, host: `${id}.example`, ...extra });
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

function setFile(file: Partial<ConnectionsFile>, extra: object = {}) {
  const full: ConnectionsFile = {
    version: 1,
    spaces: [],
    folders: [],
    connections: [],
    recents: [],
    ...file,
  };
  useConnections.setState({
    loaded: true,
    readOnly: false,
    error: null,
    warnings: [],
    sshHosts: [],
    file: full,
    ...extra,
  });
  setSpaceResolver(makeSpaceResolver(full));
}

function show() {
  return render(
    <>
      <Rail side="left" width={280} onOpenSettings={() => undefined} />
      <ConfirmDialog />
      <ConfirmCloseDialog />
    </>,
  );
}

const ws = () => useWorkspace.getState();
const firstTab = () => {
  const t = ws().tabs[0];
  if (!t) throw new Error('no tab');
  return t;
};
const firstLeaf = () => {
  const l = leaves(firstTab().root)[0];
  if (!l) throw new Error('no pane');
  return l;
};
const rail = () => screen.getByRole('complementary', { name: 'Barre latérale' });
const group = (name: string) => within(rail()).getByRole('group', { name });

beforeAll(() => {
  registerCorePanels();
});

beforeEach(() => {
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
  });
  useConnections.setState({ editing: null, editingFolder: null });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useSsh.setState({ states: {} });
  vi.mocked(removeConnection).mockClear();
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});
afterAll(() => {
  setSpaceResolver(defaultSpaceResolver);
});

test('shows favourites, pinned and today of the active space only', () => {
  setFile({
    spaces: [MAIN_SPACE, pro],
    folders: [{ id: 'f', name: 'Prod', color: '#F7768E', spaceId: null }],
    connections: [
      conn('a', 'alpha', { folderId: 'f', favorite: true }),
      conn('b', 'beta'),
      conn('z', 'zeta', { spaceId: 'pro', favorite: true }),
    ],
  });
  ws().openTab('pwsh');
  ws().switchSpace('pro');
  ws().openTab('pwsh');
  ws().switchSpace('main');
  show();
  expect(within(group('Favoris')).getByRole('button', { name: /^alpha/ })).toBeInTheDocument();
  expect(within(group('Favoris')).queryByRole('button', { name: /^zeta/ })).toBeNull();
  expect(within(group('Prod')).getByRole('button', { name: /^alpha/ })).toBeInTheDocument();
  expect(within(group('Épinglés')).getByRole('button', { name: /^beta/ })).toBeInTheDocument();
  expect(within(rail()).queryByText('zeta')).toBeNull();
  expect(within(group('Aujourd’hui')).getAllByRole('button', { name: /^PowerShell/ })).toHaveLength(
    1,
  );
});

test('a pinned row is asleep until its session opens, then shows its state', () => {
  setFile({ connections: [conn('a', 'alpha')] });
  show();
  const row = within(group('Épinglés')).getByRole('button', { name: /^alpha/ });
  expect(row).toHaveAttribute('data-state', 'asleep');
  act(() => {
    ws().openPinned('a', 'a.example', 'main');
  });
  const live = within(group('Épinglés')).getByRole('button', { name: /^alpha/ });
  expect(live).toHaveAttribute('data-state', 'live');
  const sshLeaf = firstLeaf().id;
  act(() => {
    useSsh.getState().setState(sshLeaf, { kind: 'ready' });
  });
  expect(within(live).getByRole('status', { name: 'Connecté' })).toBeInTheDocument();
});

test('a session’s status dot gives way to the close button instead of sitting under it', () => {
  setFile({ connections: [conn('a', 'alpha')] });
  show();
  act(() => {
    ws().openPinned('a', 'a.example', 'main');
  });
  act(() => {
    useSsh.getState().setState(firstLeaf().id, { kind: 'ready' });
  });
  const dot = within(group('Épinglés')).getByRole('status', { name: 'Connecté' });
  expect(dot.parentElement).toHaveClass('group-hover:opacity-0', 'group-focus-within:opacity-0');
});

test('clicking a pinned row opens then re-activates its session', async () => {
  setFile({ connections: [conn('a', 'alpha')] });
  show();
  await userEvent.click(within(group('Épinglés')).getByRole('button', { name: /^alpha/ }));
  expect(ws().tabs).toHaveLength(1);
  const pinned = firstTab().id;
  expect(firstTab().pinnedConnectionId).toBe('a');
  act(() => {
    ws().openTab('pwsh');
  });
  await userEvent.click(within(group('Épinglés')).getByRole('button', { name: /^alpha/ }));
  expect(ws().activeTabId).toBe(pinned);
  expect(ws().tabs).toHaveLength(2);
});

test('a session with several panes unfolds and a pane click focuses it', async () => {
  setFile({});
  const t = ws().openTab('pwsh');
  ws().splitActive('row');
  const first = firstLeaf();
  show();
  const panes = within(group('Aujourd’hui')).getByRole('list', { name: /Panneaux/ });
  const items = within(panes).getAllByRole('button');
  expect(items.map((b) => b.textContent)).toEqual([
    expect.stringContaining('Shell 1'),
    expect.stringContaining('Shell 2'),
  ]);
  await userEvent.click(items[0] as HTMLElement);
  expect(ws().tabs.find((x) => x.id === t)?.activeLeafId).toBe(first.id);
});

test('today lists the unpinned sessions in order', () => {
  setFile({ connections: [conn('a', 'alpha')] });
  ws().openPinned('a', 'a.example', 'main');
  const one = ws().openTab('pwsh');
  ws().renameTab(one, 'un');
  const two = ws().openTab('pwsh');
  ws().renameTab(two, 'deux');
  show();
  const today = within(group('Aujourd’hui'))
    .getAllByRole('button', { name: /^(un|deux)/ })
    .map((b) => b.getAttribute('aria-label'));
  expect(today).toEqual(['un', 'deux']);
});

test('close others and close below ask once and close only those', async () => {
  setFile({});
  const ids = ['a', 'b', 'c', 'd'].map((n) => {
    const id = ws().openTab('pwsh');
    ws().renameTab(id, n);
    return id;
  });
  show();
  fireEvent.contextMenu(within(group('Aujourd’hui')).getByRole('button', { name: 'b' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Fermer celles en dessous' }));
  await vi.waitFor(() => {
    expect(ws().tabs.map((t) => t.id)).toEqual([ids[0], ids[1]]);
  });
  fireEvent.contextMenu(within(group('Aujourd’hui')).getByRole('button', { name: 'b' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Fermer les autres' }));
  await vi.waitFor(() => {
    expect(ws().tabs.map((t) => t.id)).toEqual([ids[1]]);
  });
});

test('rename by double click', async () => {
  setFile({});
  const t = ws().openTab('pwsh');
  show();
  await userEvent.dblClick(
    within(group('Aujourd’hui')).getByRole('button', { name: /^PowerShell/ }),
  );
  const input = screen.getByRole('textbox', { name: 'Nom de la session' });
  await userEvent.clear(input);
  await userEvent.type(input, 'build{Enter}');
  expect(ws().tabs.find((x) => x.id === t)?.customTitle).toBe('build');
});

test('middle click closes', async () => {
  setFile({});
  ws().openTab('pwsh');
  show();
  fireEvent(
    within(group('Aujourd’hui')).getByRole('button', { name: /^PowerShell/ }),
    new MouseEvent('auxclick', { bubbles: true, button: 1 }),
  );
  await vi.waitFor(() => {
    expect(ws().tabs).toHaveLength(0);
  });
});

test('a session whose connection was deleted stays, in today', () => {
  setFile({ connections: [conn('a', 'alpha')] });
  ws().openPinned('a', 'a.example', 'main');
  show();
  act(() => {
    setFile({ connections: [] });
  });
  expect(ws().tabs).toHaveLength(1);
  expect(
    within(group('Aujourd’hui')).getByRole('button', { name: /^a\.example/ }),
  ).toBeInTheDocument();
});

test('pin and unpin a session from its menu', async () => {
  setFile({ connections: [conn('a', 'alpha')] });
  const t = ws().openSshTab('a.example', 'a');
  show();
  fireEvent.contextMenu(within(group('Aujourd’hui')).getByRole('button', { name: /^alpha/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Épingler' }));
  expect(ws().tabs.find((x) => x.id === t)?.pinnedConnectionId).toBe('a');
  fireEvent.contextMenu(within(group('Épinglés')).getByRole('button', { name: /^alpha/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Désépingler la session' }));
  expect(ws().tabs.find((x) => x.id === t)?.pinnedConnectionId).toBeNull();
});

// jsdom has no layout: this pins the CSS that keeps the Rail scrolling vertically only,
// with its footer always visible.
test('the rail scrolls vertically and keeps its footer', () => {
  setFile({
    connections: Array.from({ length: 50 }, (_, i) => conn(`c${String(i)}`, `host-${String(i)}`)),
  });
  for (let i = 0; i < 30; i++) ws().openTab('pwsh');
  show();
  const scroller = rail().querySelector('[data-rail-scroll]');
  expect(scroller).toHaveClass('overflow-y-auto', 'overflow-x-hidden', 'min-h-0', 'flex-1');
  // Grid tracks default to their content's width: long names must truncate instead.
  for (const list of rail().querySelectorAll('ul')) {
    expect(list).toHaveClass('grid-cols-[minmax(0,1fr)]');
  }
  expect(
    within(rail()).getByRole('button', { name: 'Réglages' }).closest('[data-rail-footer]'),
  ).toHaveClass('shrink-0');
});

test('arrow keys move between rows and Enter opens', async () => {
  setFile({ connections: [conn('a', 'alpha'), conn('b', 'beta')] });
  show();
  within(group('Épinglés'))
    .getByRole('button', { name: /^alpha/ })
    .focus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(ws().tabs[0]?.pinnedConnectionId).toBe('b');
});

test('new session opens the default shell', async () => {
  setFile({});
  show();
  await userEvent.click(within(rail()).getByRole('button', { name: 'Nouvelle session' }));
  const panel = firstLeaf().panel;
  expect(panel).toMatchObject({ kind: 'terminal', profileId: 'pwsh' });
});

test('deleting a connection asks for confirmation', async () => {
  setFile({ connections: [conn('a', 'alpha')] });
  show();
  fireEvent.contextMenu(within(group('Épinglés')).getByRole('button', { name: /^alpha/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));
  expect(removeConnection).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
  expect(removeConnection).toHaveBeenCalledWith('a');
});

test('a read-only file shows the error; warnings are listed', () => {
  setFile(
    { connections: [conn('a', 'alpha')] },
    { readOnly: true, error: { kind: 'parse', message: 'EOF', line: 4, column: 2 } },
  );
  const { unmount } = show();
  expect(screen.getByRole('alert')).toHaveTextContent('connections.json ligne 4, colonne 2 : EOF');
  unmount();
  setFile(
    { connections: [conn('a', 'alpha')] },
    { warnings: ['« alpha » : port : entre 1 et 65535'] },
  );
  show();
  expect(screen.getByText('« alpha » : port : entre 1 et 65535')).toBeInTheDocument();
});
