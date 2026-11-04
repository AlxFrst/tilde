// Opening another Tilde window.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewTabMenu } from '@/app/NewTabMenu';
import { windowNew } from '@/ipc/window';
import { useWorkspace } from '@/stores/workspace';
import { DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { registerBuiltins } from './builtin';
import { listCommands, runCommand } from './registry';

vi.mock('@/ipc/window', () => ({ windowNew: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ activeSpaceId: 'pro' });
});

test('Ctrl+Shift+N opens a new window', () => {
  expect(DEFAULT_KEYBINDINGS['window.new']).toBe('Ctrl+Shift+N');
  const off = registerBuiltins();
  expect(listCommands().find((c) => c.id === 'window.new')?.title).toBe('Nouvelle fenêtre');
  runCommand('window.new');
  // On the space this window shows.
  expect(windowNew).toHaveBeenCalledExactlyOnceWith('pro');
  off();
});

test('the menu next to « Nouvelle session » opens a new window', async () => {
  const user = userEvent.setup();
  render(<NewTabMenu />);
  await user.click(screen.getByRole('button', { name: 'Choisir un profil' }));
  await user.click(screen.getByRole('menuitem', { name: /Nouvelle fenêtre/ }));
  expect(windowNew).toHaveBeenCalledExactlyOnceWith('pro');
});
