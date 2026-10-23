import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerCommands } from '@/commands/registry';
import { useConnections } from '@/stores/connections';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { registerTerminalActions } from '@/terminal/terminalActions';
import { leaves } from '@/workspace/tree';
import { CommandPalette } from './CommandPalette';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const conn = (id: string, name: string) => ({
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
});

beforeEach(() => {
  useWorkspace.setState({ tabs: [], activeTabId: null, dormant: [] });
  useConnections.setState({
    file: {
      version: 1,
      folders: [],
      connections: [conn('a', 'Alpha'), conn('b', 'Beta')],
      recents: [{ key: 'conn:b', label: 'Beta', at: 1 }],
    },
    sshHosts: [{ alias: 'mail', hostname: 'mail.internal', user: 'me', port: 22 }],
  });
  useUi.setState({ paletteOpen: true });
});

test('palette lists connections first and runs the chosen command', async () => {
  const run = vi.fn();
  const off = registerCommands([
    { id: 'tab.new', title: 'Nouvel onglet', group: 'Onglets', run, keybinding: 'tab.new' },
  ]);
  render(<CommandPalette />);
  const options = screen.getAllByRole('option').map((o) => o.textContent);
  expect(options.slice(0, 3)).toEqual([
    expect.stringContaining('Beta'),
    expect.stringContaining('Alpha'),
    expect.stringContaining('mail'),
  ]);
  expect(options.filter((o) => o.includes('Beta'))).toHaveLength(1);

  await userEvent.type(screen.getByRole('combobox'), 'nouvel ong');
  await userEvent.keyboard('{Enter}');
  expect(run).toHaveBeenCalledTimes(1);
  expect(useUi.getState().paletteOpen).toBe(false);
  off();
});

test('choosing a connection opens it', async () => {
  render(<CommandPalette />);
  await userEvent.type(screen.getByRole('combobox'), 'alpha');
  await userEvent.keyboard('{Enter}');
  const tab = useWorkspace.getState().tabs[0];
  expect(tab && leaves(tab.root)[0]?.panel).toMatchObject({ connectionId: 'a' });
});

test('escape closes the palette and focuses the active terminal', async () => {
  useWorkspace.getState().openTab('cmd');
  const active = useWorkspace.getState().tabs[0]?.activeLeafId ?? '';
  const focus = vi.fn();
  const off = registerTerminalActions(active, {
    focus,
    copy: vi.fn(),
    paste: vi.fn(),
    search: vi.fn(),
  });
  render(<CommandPalette />);
  await userEvent.keyboard('{Escape}');
  expect(useUi.getState().paletteOpen).toBe(false);
  expect(focus).toHaveBeenCalled();
  off();
});

test('palette search folds accents and never matches internal ids', async () => {
  useConnections.setState({
    file: {
      version: 1,
      folders: [],
      connections: [{ ...conn('beef42', 'Préprod'), host: 'pp.example' }],
      recents: [],
    },
    sshHosts: [],
  });
  render(<CommandPalette />);
  const box = screen.getByRole('combobox');
  await userEvent.type(box, 'prepro');
  expect(screen.getByRole('option', { name: /Préprod/ })).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, 'beef42');
  expect(screen.queryAllByRole('option')).toEqual([]);
});

test('closing the palette with its shortcut gives the focus back to the terminal', () => {
  useWorkspace.getState().openTab('cmd');
  const active = useWorkspace.getState().tabs[0]?.activeLeafId ?? '';
  const focus = vi.fn();
  const off = registerTerminalActions(active, {
    focus,
    copy: vi.fn(),
    paste: vi.fn(),
    search: vi.fn(),
  });
  render(<CommandPalette />);
  act(() => {
    useUi.setState({ paletteOpen: false }); // what palette.toggle does
  });
  expect(focus).toHaveBeenCalled();
  off();
});
