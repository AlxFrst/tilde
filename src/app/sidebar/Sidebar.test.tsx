import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Connection, ConnectionsFile } from '@/ipc/connections';
import { removeConnection, upsertConnection } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { leaves } from '@/workspace/tree';
import { ConfirmDialog } from '../ConfirmDialog';
import { Sidebar } from '../Sidebar';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve({ ...c, id: c.id || 'new' })),
  removeConnection: vi.fn(() => Promise.resolve()),
  setFavorite: vi.fn(() => Promise.resolve()),
  openConnectionsFile: vi.fn(() => Promise.resolve()),
}));

const conn = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id,
  name,
  host: `${id}.example`,
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
  ...extra,
});

function setFile(file: Partial<ConnectionsFile>, extra: object = {}) {
  useConnections.setState({
    loaded: true,
    readOnly: false,
    error: null,
    sshHosts: [],
    file: { version: 1, folders: [], connections: [], recents: [], ...file },
    ...extra,
  });
}

function show() {
  return render(
    <>
      <Sidebar side="left" width={260} onOpenSettings={() => undefined} />
      <ConfirmDialog />
    </>,
  );
}

const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const openTargets = () =>
  useWorkspace.getState().tabs.map((t) => {
    const panel = leaves(t.root)[0]?.panel;
    return panel?.kind === 'ssh' ? [panel.target, panel.connectionId] : null;
  });

beforeEach(() => {
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  useConnections.setState({ editing: null, editingFolder: null });
  vi.mocked(upsertConnection).mockClear();
  vi.mocked(removeConnection).mockClear();
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

test('sections are ordered and empty ones hidden', () => {
  setFile(
    {
      folders: [{ id: 'f', name: 'Prod', color: null }],
      connections: [
        conn('a', 'Alpha', { favorite: true }),
        conn('b', 'Beta', { folderId: 'f' }),
        conn('web', 'Web', { host: 'web' }),
      ],
      recents: [{ key: 'conn:b', label: 'Beta', at: 1 }],
    },
    {
      sshHosts: [
        { alias: 'web', hostname: 'web.internal', user: 'me', port: 22 },
        { alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 },
      ],
    },
  );
  show();
  expect(headings()).toEqual(['Favoris', 'Récents', 'Prod', 'Sans dossier', '~/.ssh/config']);
  const sshSection = screen.getByRole('group', { name: '~/.ssh/config' });
  expect(within(sshSection).queryByText('web')).toBeNull();
  expect(within(sshSection).getByText('mail')).toBeInTheDocument();

  act(() => {
    setFile({ connections: [conn('c', 'Gamma')] });
  });
  expect(headings()).toEqual(['Sans dossier']);
});

test('double click opens a tab on the saved connection', async () => {
  setFile({ connections: [conn('a', 'Alpha')] });
  show();
  await userEvent.dblClick(screen.getByRole('button', { name: /Alpha/ }));
  expect(openTargets()).toEqual([['a.example', 'a']]);
});

test('enter opens the focused entry and arrows move between entries', async () => {
  setFile({ connections: [conn('a', 'Alpha'), conn('b', 'Beta')] });
  show();
  screen.getByRole('button', { name: /Alpha/ }).focus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(openTargets()).toEqual([['b.example', 'b']]);
});

test('adopting an ssh_config host creates a connection and hides it from the section', async () => {
  setFile({}, { sshHosts: [{ alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 }] });
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Adopter mail' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: '', name: 'mail', host: 'mail' }),
  );
  act(() => {
    setFile(
      { connections: [conn('new', 'mail', { host: 'mail' })] },
      { sshHosts: [{ alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 }] },
    );
  });
  expect(screen.queryByRole('group', { name: '~/.ssh/config' })).toBeNull();
  expect(useConnections.getState().editing).toMatchObject({ id: 'new' });
});

test('search shows a flat result list and offers to connect to a typed target', async () => {
  setFile(
    { connections: [conn('a', 'Alpha', { tags: ['web'] }), conn('b', 'Beta')] },
    { sshHosts: [{ alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 }] },
  );
  show();
  const box = screen.getByRole('searchbox', { name: 'Rechercher une connexion' });
  await userEvent.type(box, 'web');
  expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Beta/ })).toBeNull();

  await userEvent.clear(box);
  await userEvent.type(box, 'root@10.0.0.9:2222');
  expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: /Se connecter à « root@10.0.0.9:2222 »/ }),
  );
  expect(openTargets()).toEqual([['root@10.0.0.9:2222', null]]);
});

test('deleting asks for confirmation', async () => {
  setFile({ connections: [conn('a', 'Alpha')] });
  show();
  fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));
  expect(removeConnection).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
  expect(removeConnection).toHaveBeenCalledWith('a');
});

test('read-only file shows the error and disables editing', () => {
  setFile(
    { connections: [conn('a', 'Alpha')] },
    { readOnly: true, error: { kind: 'parse', message: 'EOF', line: 4, column: 2 } },
  );
  show();
  expect(screen.getByRole('alert')).toHaveTextContent('connections.json ligne 4, colonne 2 : EOF');
  expect(screen.getByRole('button', { name: 'Ouvrir le fichier' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
});

test('connections that cannot be opened as written are listed', () => {
  setFile(
    { connections: [conn('a', 'Alpha')] },
    { warnings: ['« Alpha » : port : entre 1 et 65535'] },
  );
  show();
  expect(screen.getByText('« Alpha » : port : entre 1 et 65535')).toBeInTheDocument();
  expect(screen.getByText(/À corriger avant de pouvoir s’y connecter/)).toBeInTheDocument();
});

// jsdom has no layout: these pin the CSS that keeps long names from widening the sidebar.
test('the sidebar never scrolls sideways', () => {
  setFile({ connections: [conn('a', 'a-very-long-connection-name-that-does-not-fit-anywhere')] });
  show();
  const row = screen.getByRole('button', { name: /a-very-long/ });
  const list = row.closest('[role="group"] > div');
  // Grid tracks default to their content's width; minmax(0, 1fr) lets rows truncate instead.
  expect(list).toHaveClass('grid-cols-[minmax(0,1fr)]');
  expect(row.closest('.overflow-y-auto')).toHaveClass('overflow-x-hidden');
});
