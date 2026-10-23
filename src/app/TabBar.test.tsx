import { fireEvent, render, screen } from '@testing-library/react';
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
  expect(leaves(t.root)[0]?.panel.profileId).toBe('wsl:Ubuntu');
});

test('new tab menu lists profiles', async () => {
  const user = userEvent.setup();
  render(<TabBar />);
  await user.click(screen.getByRole('button', { name: 'Choisir un profil' }));
  await user.click(await screen.findByRole('menuitem', { name: /Ubuntu \(WSL\)/ }));
  expect(
    leaves(
      ws().tabs[0]?.root ?? {
        type: 'leaf',
        id: '',
        panel: { kind: 'terminal', profileId: '', cwd: null, title: null },
      },
    )[0]?.panel.profileId,
  ).toBe('wsl:Ubuntu');
});
