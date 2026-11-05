import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { registerBuiltins } from '@/commands/builtin';
import { runCommand } from '@/commands/registry';
import { MAIN_SPACE } from '@/connections/spaces';
import type { ConnectionsFile } from '@/ipc/connections';
import type { ResolvedProfile } from '@/ipc/profiles';
import { registerCorePanels } from '@/panels/core';
import { blankConnection, useConnections } from '@/stores/connections';
import { useProfiles } from '@/stores/profiles';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { shownView, useWorkspace } from '@/stores/workspace';
import { defaultSettings } from '@/test/fixtures';
import { defaultSpaceResolver, makeSpaceResolver, setSpaceResolver } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import { viewTabs } from '@/workspace/view';
import { CommandPalette, sshCommand } from './CommandPalette';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(() => Promise.resolve()),
  readText: vi.fn(() => Promise.resolve('')),
}));

const pro = {
  id: 'pro',
  name: 'Pro',
  color: null,
  icon: 'briefcase',
  themeDark: null,
  themeLight: null,
};
const prod = blankConnection({
  id: 'p',
  name: 'prod',
  host: 'prod.example',
  user: 'deploy',
  port: 2222,
  proxyJump: 'bastion,jump2',
  spaceId: 'pro',
});
const file: ConnectionsFile = {
  version: 1,
  spaces: [MAIN_SPACE, pro],
  folders: [],
  connections: [prod],
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
const combobox = () => screen.getByRole('combobox');
let stopCommands: () => void = () => undefined;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  registerCorePanels();
});
beforeEach(() => {
  vi.clearAllMocks();
  useConnections.setState({ file, sshHosts: [], loaded: true });
  setSpaceResolver(makeSpaceResolver(file));
  useWorkspace.setState({
    tabs: [],
    activeTabId: null,
    dormant: [],
    activeSpaceId: 'main',
    activeTabBySpace: {},
    views: {},
  });
  useProfiles.setState({ profiles: [profile], loaded: true });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  useUi.setState({ paletteOpen: true, peek: null });
  stopCommands = registerBuiltins();
});
afterEach(() => {
  stopCommands();
  setSpaceResolver(defaultSpaceResolver);
});

test('open sessions are listed and switch space', async () => {
  act(() => {
    ws().switchSpace('pro');
    const t = ws().openTab('pwsh');
    ws().renameTab(t, 'build');
    ws().switchSpace('main');
  });
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'build');
  const sessions = screen.getByRole('group', { name: 'Sessions' });
  expect(within(sessions).getByRole('option', { name: /build/ })).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(ws().activeSpaceId).toBe('pro');
});

test('spaces are listed', async () => {
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'pro');
  const spaces = screen.getByRole('group', { name: 'Espaces' });
  await userEvent.click(within(spaces).getByRole('option', { name: /Pro/ }));
  expect(ws().activeSpaceId).toBe('pro');
});

test("arrow right opens a host's actions and arrow left goes back", async () => {
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'prod');
  await userEvent.keyboard('{ArrowRight}');
  const actions = screen.getAllByRole('option').map((o) => o.textContent);
  expect(actions).toEqual([
    expect.stringContaining('Se connecter'),
    expect.stringContaining('Se connecter à côté'),
    expect.stringContaining('Fichiers'),
    expect.stringContaining('Moniteur'),
    expect.stringContaining('Copier la commande ssh'),
    expect.stringContaining('Modifier'),
  ]);
  expect(combobox()).toHaveValue('');
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('option', { name: /prod/ })).toBeInTheDocument();
});

test('copy ssh command builds the command with jump hosts and port', async () => {
  expect(sshCommand(prod)).toBe('ssh -J bastion,jump2 -p 2222 deploy@prod.example');
  expect(sshCommand({ host: 'mail', user: null, port: null, proxyJump: null })).toBe('ssh mail');
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'prod');
  await userEvent.keyboard('{ArrowRight}');
  await userEvent.click(screen.getByRole('option', { name: /Copier la commande ssh/ }));
  expect(writeText).toHaveBeenCalledWith('ssh -J bastion,jump2 -p 2222 deploy@prod.example');
});

test('connect beside splits the active pane', async () => {
  act(() => {
    ws().openTab('pwsh');
  });
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'prod');
  await userEvent.keyboard('{ArrowRight}');
  await userEvent.click(screen.getByRole('option', { name: /Se connecter à côté/ }));
  const tab = ws().tabs[0];
  expect(tab && leaves(tab.root).map((l) => l.panel.kind)).toEqual(['terminal', 'ssh']);
  expect(ws().tabs).toHaveLength(1);
});

test('files and monitor actions open the connection with them', async () => {
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'prod');
  await userEvent.keyboard('{ArrowRight}');
  await userEvent.click(screen.getByRole('option', { name: /Fichiers/ }));
  const tab = ws().tabs[0];
  expect(tab && leaves(tab.root).map((l) => l.panel.kind)).toEqual(['ssh', 'sftp']);
});

test('english words find french commands', async () => {
  render(<CommandPalette />);
  await userEvent.type(combobox(), 'split');
  expect(screen.getByRole('option', { name: /Diviser à droite/ })).toBeInTheDocument();
});

describe('side by side', () => {
  const sessions = (...names: string[]) =>
    names.map((n) => {
      const id = ws().openTab('pwsh');
      ws().renameTab(id, n);
      return id;
    });
  const shown = () => {
    const view = shownView(ws());
    return view ? viewTabs(view) : [];
  };

  test('arrow right on a session lists what can be done with it', async () => {
    let alpha = '';
    act(() => {
      [alpha = ''] = sessions('alpha', 'beta');
      ws().activateTab(alpha);
    });
    render(<CommandPalette />);
    await userEvent.type(combobox(), 'beta');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Afficher'),
      expect.stringContaining('Ouvrir à droite'),
      expect.stringContaining('Ouvrir en bas'),
    ]);
  });

  test('open on the right from the palette forms a view', async () => {
    let ids: string[] = [];
    act(() => {
      ids = sessions('alpha', 'beta');
      ws().activateTab(ids[0] ?? '');
    });
    render(<CommandPalette />);
    await userEvent.type(combobox(), 'beta');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(screen.getByRole('option', { name: /Ouvrir à droite/ }));
    expect(shown()).toEqual(ids);
  });

  test('a session of the view can be shown alone or taken out of it', async () => {
    act(() => {
      const [a = '', b = ''] = sessions('alpha', 'beta');
      ws().placeInView(b, a, 'right');
    });
    render(<CommandPalette />);
    await userEvent.type(combobox(), 'alpha');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('option', { name: /Afficher seule/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Retirer de la vue/ }));
    expect(shown()).toEqual([]);
  });

  test('the remove and show-alone commands act on the active session', () => {
    const [a = '', b = ''] = sessions('alpha', 'beta');
    ws().placeInView(b, a, 'right');
    runCommand('view.showAlone');
    expect(shown()).toEqual([]);
    expect(ws().activeTabId).toBe(b);
    ws().activateTab(b);
    expect(shown()).toEqual([a, b]);
    runCommand('view.removeActive');
    expect(shown()).toEqual([]);
    expect(ws().tabs).toHaveLength(2);
  });

  test('side by side words find the view commands', async () => {
    render(<CommandPalette />);
    await userEvent.type(combobox(), 'side by side');
    expect(
      screen.getByRole('option', { name: /Retirer la session de la vue/ }),
    ).toBeInTheDocument();
  });
});
