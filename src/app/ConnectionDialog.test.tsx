import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { upsertConnection, upsertFolder, type Connection } from '@/ipc/connections';
import { blankConnection, useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { leaves } from '@/workspace/tree';
import { ConnectionDialog } from './ConnectionDialog';
import { FolderDialog } from './FolderDialog';

vi.mock('@/ipc/connections', async (orig) => ({
  ...(await orig<typeof import('@/ipc/connections')>()),
  upsertConnection: vi.fn((c: Connection) => Promise.resolve({ ...c, id: c.id || 'new-id' })),
  upsertFolder: vi.fn((f: { id: string }) => Promise.resolve({ ...f, id: f.id || 'f-new' })),
}));

beforeEach(() => {
  vi.mocked(upsertConnection).mockClear();
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  useConnections.setState({
    readOnly: false,
    sshHosts: [{ alias: 'prod', hostname: 'prod.internal', user: 'deploy', port: 22 }],
    file: {
      version: 1,
      folders: [{ id: 'f1', name: 'Prod', color: null }],
      connections: [],
      recents: [],
    },
    editing: null,
    editingFolder: null,
  });
});

function edit(c: Connection) {
  useConnections.setState({ editing: c });
  render(<ConnectionDialog />);
}

const field = (name: string) => screen.getByLabelText(name);

test('validates fields before saving', async () => {
  edit(blankConnection());
  await userEvent.type(field('Nom'), 'Base');
  await userEvent.type(field('Port'), '70000');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(upsertConnection).not.toHaveBeenCalled();
  expect(screen.getByText('Indiquez un hôte ou un alias de ~/.ssh/config')).toBeInTheDocument();
  expect(screen.getByText('Entre 1 et 65535')).toBeInTheDocument();
});

test('shows a backend field error under that field', async () => {
  vi.mocked(upsertConnection).mockRejectedValueOnce({
    kind: 'invalid',
    message: 'valeurs hors limites : proxyJump (saut vide)',
    path: 'proxyJump',
  });
  edit(blankConnection({ name: 'A', host: 'a.example', proxyJump: 'b1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/saut vide/)).toBeInTheDocument();
  expect(field('ProxyJump')).toHaveAttribute('aria-invalid', 'true');
  expect(useConnections.getState().editing).not.toBeNull();
});

test('save and connect opens a tab', async () => {
  edit(blankConnection());
  await userEvent.type(field('Nom'), 'Prod');
  await userEvent.type(field('Hôte'), 'prod');
  expect(screen.getByText(/réglages de ~\/.ssh\/config pour cet alias/)).toBeInTheDocument();
  await userEvent.type(field('Tags'), 'web, eu ,web');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer et se connecter' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: '', name: 'Prod', host: 'prod', tags: ['web', 'eu'] }),
  );
  const tab = useWorkspace.getState().tabs[0];
  expect(tab && leaves(tab.root)[0]?.panel).toMatchObject({
    kind: 'ssh',
    target: 'prod',
    connectionId: 'new-id',
  });
  expect(useConnections.getState().editing).toBeNull();
});

test('editing keeps the id and the fields the form does not show', async () => {
  edit(
    blankConnection({
      id: 'c9',
      name: 'Old',
      host: 'h',
      favorite: true,
      folderId: 'f1',
      forwardAgent: true,
    }),
  );
  await userEvent.clear(field('Nom'));
  await userEvent.type(field('Nom'), 'New');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(upsertConnection).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'c9',
      name: 'New',
      favorite: true,
      folderId: 'f1',
      forwardAgent: true,
    }),
  );
});

test('a new folder is created with its name and colour', async () => {
  useConnections.setState({ editingFolder: 'new' });
  render(<FolderDialog />);
  await userEvent.type(screen.getByLabelText('Nom du dossier'), 'Staging');
  await userEvent.click(screen.getByRole('radio', { name: 'Vert' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(upsertFolder).toHaveBeenCalledWith({ id: '', name: 'Staging', color: '#9ECE6A' });
});
