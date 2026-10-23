import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerCommands } from '@/commands/registry';
import { keybindingsReset, keybindingsSet } from '@/ipc/keybindings';
import { useKeybindings } from '@/stores/keybindings';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { defaultSettings } from '@/test/fixtures';
import { compileBindings, DEFAULT_KEYBINDINGS } from '@/terminal/keys';
import { useShortcuts } from '../useShortcuts';
import { ShortcutsSection } from './ShortcutsSection';

vi.mock('@/ipc/keybindings', () => ({
  keybindingsSet: vi.fn(() => Promise.resolve()),
  keybindingsReset: vi.fn(() => Promise.resolve()),
  keybindingsGet: vi.fn(),
  openKeybindingsFile: vi.fn(() => Promise.resolve()),
  onKeybindingsChanged: vi.fn(() => Promise.resolve(() => undefined)),
  onKeybindingsError: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let unregister: () => void = () => undefined;
const palette = vi.fn();

function state(overrides: Record<string, string | null>) {
  const effective = { ...DEFAULT_KEYBINDINGS, ...overrides };
  useKeybindings.setState({
    overrides,
    effective,
    table: compileBindings(effective),
    invalid: [],
    readOnly: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state({});
  useUi.setState({ recordingShortcut: false });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  unregister = registerCommands([
    { id: 'tab.new', title: 'Nouvel onglet', group: 'Onglets', run: vi.fn() },
    { id: 'tab.close', title: 'Fermer l’onglet', group: 'Onglets', run: vi.fn() },
    { id: 'palette.toggle', title: 'Palette', group: 'Application', run: palette },
  ]);
});
afterEach(() => {
  unregister();
});

const press = (init: KeyboardEventInit) => {
  fireEvent.keyDown(window, init);
};

async function record(title: string) {
  await userEvent.click(screen.getByRole('button', { name: `Modifier ${title}` }));
}

test('records a new binding', async () => {
  render(<ShortcutsSection />);
  await record('Nouvel onglet');
  expect(useUi.getState().recordingShortcut).toBe(true);
  press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
  await vi.waitFor(() => {
    expect(keybindingsSet).toHaveBeenCalledWith('tab.new', 'Ctrl+Alt+N');
  });
  expect(useUi.getState().recordingShortcut).toBe(false);
});

test('refuses a binding without modifier', async () => {
  render(<ShortcutsSection />);
  await record('Nouvel onglet');
  press({ key: 'a', code: 'KeyA' });
  expect(await screen.findByRole('alert')).toHaveTextContent(/Ajoutez Ctrl ou Alt/);
  press({ key: 'A', code: 'KeyA', shiftKey: true });
  expect(keybindingsSet).not.toHaveBeenCalled();
});

test('shows the conflicting command and can replace it', async () => {
  render(<ShortcutsSection />);
  await record('Nouvel onglet');
  press({ key: 'W', code: 'KeyW', ctrlKey: true, shiftKey: true });
  expect(await screen.findByText(/Déjà utilisé par « Fermer l’onglet »/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await vi.waitFor(() => {
    expect(keybindingsSet).toHaveBeenCalledWith('tab.new', 'Ctrl+Shift+W');
  });
  expect(keybindingsSet).toHaveBeenCalledWith('tab.close', null);
});

test('reset restores the default', async () => {
  state({ 'tab.new': 'Ctrl+Alt+T' });
  render(<ShortcutsSection />);
  expect(screen.getByText('modifié')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser Nouvel onglet' }));
  expect(keybindingsReset).toHaveBeenCalledWith('tab.new');
});

test('app shortcuts are paused while recording', async () => {
  renderHook(() => {
    useShortcuts();
  });
  render(<ShortcutsSection />);
  press({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
  expect(palette).toHaveBeenCalledTimes(1);
  await record('Nouvel onglet');
  press({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
  expect(palette).toHaveBeenCalledTimes(1);
});

test('warns before taking a control key the shell uses', async () => {
  render(<ShortcutsSection />);
  await record('Nouvel onglet');
  press({ key: 'r', code: 'KeyR', ctrlKey: true });
  expect(await screen.findByText(/Utilisé par le shell/)).toBeInTheDocument();
  expect(keybindingsSet).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Utiliser quand même' }));
  await vi.waitFor(() => {
    expect(keybindingsSet).toHaveBeenCalledWith('tab.new', 'Ctrl+R');
  });
});
