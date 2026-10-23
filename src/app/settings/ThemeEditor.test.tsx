import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { themesImportPick, themesSave } from '@/ipc/themes';
import { useSettings } from '@/stores/settings';
import { useThemes } from '@/stores/themes';
import { defaultSettings } from '@/test/fixtures';
import { getTheme, type ThemeDefinition } from '@/themes';
import { ThemeEditor } from './ThemeEditor';
import { ThemesSection } from './ThemesSection';

vi.mock('@/ipc/themes', () => ({
  themesSave: vi.fn(() => Promise.resolve()),
  themesDelete: vi.fn(() => Promise.resolve()),
  themesImportPick: vi.fn(() => Promise.resolve(null)),
  themesExport: vi.fn(() => Promise.resolve(true)),
  openThemesDir: vi.fn(() => Promise.resolve()),
  themesList: vi.fn(() => Promise.resolve({ themes: [], errors: [] })),
  onThemesChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const tilde = getTheme('tilde-dark') as ThemeDefinition;

beforeEach(() => {
  vi.clearAllMocks();
  useThemes.setState({ user: [], errors: [], preview: null });
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
});

async function setHex(label: string, value: string) {
  const input = screen.getByLabelText(`${label} (hex)`);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

test('editing a color previews it live', async () => {
  render(<ThemeEditor initial={tilde} isNew onClose={vi.fn()} />);
  expect(useThemes.getState().preview?.id).toBe('tilde-dark');
  await setHex('Accent', '#123456');
  expect(useThemes.getState().preview?.ui.accent).toBe('#123456');
  await setHex('Rouge', '#ABCDEF');
  expect(useThemes.getState().preview?.terminal.red).toBe('#ABCDEF');
});

test('cancel restores the previous theme', async () => {
  const onClose = vi.fn();
  render(<ThemeEditor initial={tilde} isNew onClose={onClose} />);
  await setHex('Accent', '#123456');
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(useThemes.getState().preview).toBeNull();
  expect(onClose).toHaveBeenCalled();
});

test('warns when contrast is too low', async () => {
  render(<ThemeEditor initial={tilde} isNew onClose={vi.fn()} />);
  expect(screen.queryByRole('alert')).toBeNull();
  await setHex('Texte', '#30343C');
  expect(screen.getByRole('alert')).toHaveTextContent(/contraste/i);
  // A warning only: saving stays possible.
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
});

test('saving a new theme picks a unique id', async () => {
  const onClose = vi.fn();
  render(<ThemeEditor initial={tilde} isNew onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(themesSave).toHaveBeenCalledWith(
    'tilde-dark-2',
    expect.objectContaining({ name: 'Tilde Dark' }) as unknown,
  );
  expect(useThemes.getState().preview).toBeNull();
  expect(onClose).toHaveBeenCalled();
});

test('import with several schemes asks which to keep', async () => {
  const text = readFileSync(
    join(__dirname, '../../themes/importers/fixtures/wt-settings.json'),
    'utf8',
  );
  vi.mocked(themesImportPick).mockResolvedValueOnce({ name: 'settings.json', text });
  render(<ThemesSection />);
  await userEvent.click(screen.getByRole('button', { name: /Importer/ }));
  const chooser = await screen.findByRole('group', { name: 'Thèmes à importer' });
  const boxes = within(chooser).getAllByRole('checkbox');
  expect(boxes).toHaveLength(2);
  expect(screen.getByText(/Broken/)).toBeInTheDocument();
  await userEvent.click(within(chooser).getByLabelText('One Half Light'));
  await userEvent.click(screen.getByRole('button', { name: 'Importer la sélection' }));
  expect(themesSave).toHaveBeenCalledTimes(1);
  expect(themesSave).toHaveBeenCalledWith(
    'one-half-dark',
    expect.objectContaining({ name: 'One Half Dark' }) as unknown,
  );
});

test('a single imported scheme opens the editor', async () => {
  const text = readFileSync(
    join(__dirname, '../../themes/importers/fixtures/base16-ocean.yaml'),
    'utf8',
  );
  vi.mocked(themesImportPick).mockResolvedValueOnce({ name: 'ocean.yaml', text });
  render(<ThemesSection />);
  await userEvent.click(screen.getByRole('button', { name: /Importer/ }));
  expect(await screen.findByLabelText('Nom du thème')).toHaveValue('Ocean');
  expect(useThemes.getState().preview?.terminal.background).toBe('#2B303B');
});
