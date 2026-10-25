import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLocale } from '@/i18n';
import { useSettings } from '@/stores/settings';
import { useUi } from '@/stores/ui';
import { useWindowEffects } from '@/stores/windowEffects';
import { defaultSettings } from '@/test/fixtures';
import { isFontAvailable } from '@/themes/fonts';
import { SettingsDialog } from './SettingsDialog';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const update = vi.fn(() => Promise.resolve());

beforeEach(() => {
  update.mockClear();
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null, update });
  useUi.setState({ settingsSection: 'appearance' });
  useWindowEffects.setState({ applied: 'none', supported: ['none', 'mica', 'acrylic'] });
});

/** Dotted paths of every setting leaf (profiles are edited elsewhere). */
function leaves(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const sections = () =>
  within(screen.getByRole('navigation', { name: 'Sections des réglages' })).getAllByRole('button');

test('every settings key has a control', async () => {
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  const seen = new Set<string>();
  for (const button of sections()) {
    await userEvent.click(button);
    document.querySelectorAll('[data-setting]').forEach((el) => {
      seen.add(el.getAttribute('data-setting') ?? '');
    });
  }
  const missing = leaves(defaultSettings).filter(
    (path) => path !== 'version' && path !== 'profiles' && !seen.has(path),
  );
  expect(missing).toEqual([]);
});

test('number fields refuse out-of-range values', async () => {
  useUi.setState({ settingsSection: 'terminal' });
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  const input = screen.getByLabelText('Taille de police du terminal');
  await userEvent.clear(input);
  await userEvent.type(input, '100{Enter}');
  expect(screen.getByText(/entre 6 et 72/)).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
  await userEvent.clear(input);
  await userEvent.type(input, '16{Enter}');
  expect(update).toHaveBeenCalledWith({ terminal: { fontSize: 16 } });
});

test('shows the settings in English, numbers included', async () => {
  setLocale('en');
  useUi.setState({ settingsSection: 'terminal' });
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  expect(screen.getByRole('navigation', { name: 'Settings sections' })).toHaveTextContent(
    'AppearanceThemesTerminalShortcutsSSHSFTPGeneral',
  );
  expect(screen.getByRole('radio', { name: 'Underline' })).toBeInTheDocument();
  const input = screen.getByLabelText('Terminal line height');
  await userEvent.clear(input);
  await userEvent.type(input, '5{Enter}');
  expect(screen.getByText('between 0.8 and 3')).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test('choosing an effect at full opacity lowers it', async () => {
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Mica' }));
  expect(update).toHaveBeenCalledWith({
    appearance: { window: { effect: 'mica', opacity: 0.85 } },
  });
  // Unsupported effects are shown but cannot be picked.
  expect(screen.getByRole('radio', { name: 'Vibrancy' })).toBeDisabled();
});

test('read-only settings disable every control', async () => {
  useSettings.setState({ readOnly: true });
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  for (const button of sections()) {
    await userEvent.click(button);
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const controls = el.matches('input, button, select')
        ? [el]
        : [...el.querySelectorAll('input, button, select')];
      for (const c of controls) {
        expect(c, el.getAttribute('data-setting') ?? '').toBeDisabled();
      }
    });
  }
});

test('detects a missing font', () => {
  // Widths per font stack: a missing font falls back, so both stacks measure the same.
  const widths: Record<string, number> = {
    monospace: 100,
    serif: 120,
    '"Fira Code", monospace': 110,
    '"Fira Code", serif': 110,
    '"Nope", monospace': 100,
    '"Nope", serif': 120,
  };
  const measure = (font: string) => widths[font] ?? 0;
  expect(isFontAvailable('Fira Code', measure)).toBe(true);
  expect(isFontAvailable('Nope', measure)).toBe(false);
});
