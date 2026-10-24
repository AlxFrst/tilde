// The chosen option must read at a glance in every picker: an accent border on an accent
// tint (never the grey that hover also uses), and a check mark on colour swatches.

import { render, screen } from '@testing-library/react';
import { ColorPicker } from '@/app/ColorPicker';
import { IconPicker } from '@/app/IconPicker';
import { Choice } from '@/app/settings/fields';
import { ThemesSection } from '@/app/settings/ThemesSection';
import { SELECTED } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { defaultSettings } from '@/test/fixtures';

const selectedClasses = SELECTED.split(' ');

function expectSelected(el: HTMLElement) {
  for (const c of selectedClasses) expect(el).toHaveClass(c);
}

function expectNotSelected(el: HTMLElement) {
  expect(el).not.toHaveClass('bg-primary/15');
}

test('a settings choice marks the current option, not the others', () => {
  render(
    <Choice
      setting="appearance.colorScheme"
      label="Apparence"
      value="dark"
      options={[
        ['system', 'Système'],
        ['dark', 'Sombre'],
        ['light', 'Clair'],
      ]}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  // Radix toggles style their state through `data-state`.
  const sombre = screen.getByRole('radio', { name: 'Sombre' });
  expect(sombre).toHaveAttribute('data-state', 'on');
  for (const c of selectedClasses) expect(sombre).toHaveClass(`data-[state=on]:${c}`);
  expect(screen.getByRole('radio', { name: 'Système' })).toHaveAttribute('data-state', 'off');
  expect(screen.getByRole('radio', { name: 'Clair' })).toHaveAttribute('data-state', 'off');
});

test('the chosen colour carries a check mark', () => {
  render(<ColorPicker label="Couleur" value="#9ece6a" onChange={vi.fn()} />);
  const chosen = screen.getByRole('radio', { checked: true });
  expect(chosen).toHaveAccessibleName('Vert');
  expect(chosen.querySelector('.lucide-check')).not.toBeNull();
  expect(screen.getByRole('radio', { name: 'Rouge' }).querySelector('.lucide-check')).toBeNull();
});

test('« Aucune » is marked when no colour is chosen', () => {
  render(<ColorPicker label="Couleur" value={null} onChange={vi.fn()} />);
  expectSelected(screen.getByRole('radio', { name: 'Aucune' }));
});

test('the icon picker marks the chosen icon', () => {
  render(
    <IconPicker
      label="Icône"
      icons={['server', 'database', 'cloud']}
      value="database"
      color={null}
      onChange={vi.fn()}
    />,
  );
  expectSelected(screen.getByRole('radio', { name: 'database' }));
  expectNotSelected(screen.getByRole('radio', { name: 'server' }));
});

test('the themes in use are marked, not just greyed out', () => {
  useSettings.setState({ settings: defaultSettings, readOnly: false, error: null });
  render(<ThemesSection />);
  const dark = screen.getByText('Tilde Dark').closest('li');
  expect(dark).not.toBeNull();
  expect(dark).toHaveTextContent('Utilisé en sombre');
  expect(dark?.querySelector('.lucide-check')).not.toBeNull();
  const other = screen.getByText('Dracula').closest('li');
  expect(other).toHaveTextContent('Utiliser en sombre');
});
