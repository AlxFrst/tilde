import { fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import userEvent from '@testing-library/user-event';
import { useSettings } from '@/stores/settings';
import { defaultSettings } from '@/test/fixtures';
import { GeneralSection } from './GeneralSection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const update = vi.fn(() => Promise.resolve());

beforeEach(() => {
  update.mockClear();
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null, update });
});

test('the Quake shortcut refuses symbol keys, which move with the keyboard layout', async () => {
  render(<GeneralSection />);
  await userEvent.click(screen.getByRole('button', { name: 'Modifier le raccourci Quake' }));
  // AZERTY: the ² key is the physical Backquote key.
  fireEvent.keyDown(window, { key: '²', code: 'Backquote', ctrlKey: true });
  expect(await screen.findByRole('alert')).toHaveTextContent(/lettre, un chiffre ou une touche F/);
  expect(update).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'F12', code: 'F12', altKey: true });
  expect(update).toHaveBeenCalledWith({ general: { quake: { shortcut: 'Alt+F12' } } });
});

test('a Quake shortcut that could not be registered is shown', async () => {
  vi.mocked(invoke).mockImplementation((cmd: string) =>
    Promise.resolve(
      cmd === 'quake_status' ? 'Raccourci Quake « Alt+F12 » indisponible : déjà pris' : null,
    ),
  );
  render(<GeneralSection />);
  expect(await screen.findByText(/indisponible : déjà pris/)).toBeInTheDocument();
});
