import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAIN_SPACE } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import type { ResolvedProfile } from '@/ipc/profiles';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import type { Tab } from '@/workspace/types';
import { SessionHeader } from './SessionHeader';
import { sessionEnv } from './sessionEnv';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(() => Promise.resolve(() => undefined)),
  }),
}));

const demo = blankConnection({
  id: 'c1',
  name: 'demo-server',
  host: 'demo',
  user: 'deploy',
  proxyJump: 'bastion,jump2',
  folderId: 'f',
});
const file: ConnectionsFile = {
  version: 1,
  spaces: [],
  folders: [
    { id: 'f', name: 'Prod', color: '#F7768E', spaceId: null },
    { id: 'g', name: 'Lab', color: null, spaceId: null },
  ],
  connections: [demo, blankConnection({ id: 'c2', name: 'lab', host: 'lab', folderId: 'g' })],
  recents: [],
};
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

const ws = () => useWorkspace.getState();
const activeTab = (): Tab => {
  const t = ws().tabs.find((x) => x.id === ws().activeTabId);
  if (!t) throw new Error('no active tab');
  return t;
};
const kinds = () => leaves(activeTab().root).map((l) => l.panel.kind);
const header = () => screen.getByRole('banner');

beforeAll(() => {
  registerCorePanels();
});
beforeEach(() => {
  useConnections.setState({ file, loaded: true });
  setSpaceResolver(makeSpaceResolver(file));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: MAIN_SPACE.id,
    activeTabBySpace: {},
  });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
});
afterAll(() => {
  setSpaceResolver(defaultSpaceResolver);
});

test('without a session the header says Tilde and keeps the window controls', () => {
  render(<SessionHeader platform="windows" />);
  expect(header()).toHaveTextContent('Tilde');
  expect(within(header()).getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
});

test('the header names the session, its host and its jump hosts', () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<SessionHeader platform="macos" />);
  expect(header()).toHaveTextContent('PROD');
  expect(header()).toHaveTextContent('demo-server');
  expect(header()).toHaveTextContent('deploy@demo');
  expect(header()).toHaveTextContent('via bastion → jump2');
  expect(within(header()).queryByRole('button', { name: 'Fermer' })).toBeNull();
});

test("ssh actions toggle the files and the monitor of the active pane's session", async () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<SessionHeader platform="windows" />);
  const files = within(header()).getByRole('button', { name: 'Fichiers' });
  expect(files).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(files);
  expect(kinds()).toEqual(['ssh', 'sftp']);
  // The files are now the active pane: the buttons still act on their session.
  expect(within(header()).getByRole('button', { name: 'Fichiers' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The monitor shows over the session (Peek), for the session of the active pane.
  await userEvent.click(within(header()).getByRole('button', { name: 'Moniteur' }));
  expect(useUi.getState().peek).toEqual({ sshLeafId: leaves(activeTab().root)[0]?.id });
  expect(kinds()).toEqual(['ssh', 'sftp']);
});

test('plus shell opens a shell on the same host', async () => {
  ws().openPinned('c1', 'demo', 'main');
  render(<SessionHeader platform="windows" />);
  await userEvent.click(within(header()).getByRole('button', { name: 'Nouveau shell' }));
  const panels = leaves(activeTab().root).map((l) => l.panel);
  expect(panels).toEqual([
    expect.objectContaining({ kind: 'ssh', connectionId: 'c1' }),
    expect.objectContaining({ kind: 'ssh', connectionId: 'c1', target: 'demo' }),
  ]);
});

test('split buttons split the active pane; a local session has no ssh actions', async () => {
  ws().openTab('pwsh');
  render(<SessionHeader platform="windows" />);
  expect(within(header()).queryByRole('button', { name: 'Fichiers' })).toBeNull();
  await userEvent.click(within(header()).getByRole('button', { name: 'Diviser à droite' }));
  await userEvent.click(within(header()).getByRole('button', { name: 'Diviser en bas' }));
  expect(kinds()).toEqual(['terminal', 'terminal', 'terminal']);
});

test('splitting an editor opens the default shell', async () => {
  ws().openEditor(null, { kind: 'local', docId: 1, name: 'NOTES.md' });
  render(<SessionHeader platform="windows" />);
  await userEvent.click(within(header()).getByRole('button', { name: 'Diviser à droite' }));
  expect(leaves(activeTab().root).map((l) => l.panel)).toEqual([
    expect.objectContaining({ kind: 'editor' }),
    expect.objectContaining({ kind: 'terminal', profileId: 'pwsh' }),
  ]);
});

test('sessionEnv follows the active pane', () => {
  ws().openPinned('c1', 'demo', 'main');
  expect(sessionEnv(activeTab(), file)).toEqual({ label: 'PROD', color: '#F7768E' });
  const ssh = activeTab().activeLeafId;
  ws().toggleSftp(ssh);
  expect(sessionEnv(activeTab(), file)).toEqual({ label: 'PROD', color: '#F7768E' });
  ws().splitActive('row', 'pwsh');
  expect(leaves(activeTab().root).find((l) => l.id === activeTab().activeLeafId)?.panel.kind).toBe(
    'terminal',
  );
  expect(sessionEnv(activeTab(), file)).toBeNull();
  ws().openPinned('c2', 'lab', 'main');
  expect(sessionEnv(activeTab(), file)).toBeNull();
});

test('a pane shown alone can always be brought back from the header', async () => {
  ws().openTab('pwsh');
  ws().toggleZoom(activeTab().id, activeTab().activeLeafId);
  useUi.setState({ railHidden: false });
  render(<SessionHeader platform="windows" />);
  expect(within(header()).queryByRole('button', { name: 'Afficher la barre latérale' })).toBeNull();
  await userEvent.click(within(header()).getByRole('button', { name: 'Réduire le panneau' }));
  expect(ws().zoomed[activeTab().id]).toBeUndefined();
  expect(within(header()).queryByRole('button', { name: 'Réduire le panneau' })).toBeNull();
});
