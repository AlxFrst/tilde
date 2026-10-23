import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChmodDialog } from './ChmodDialog';

test('chmod dialog keeps octal and checkboxes in sync', async () => {
  const onApply = vi.fn();
  render(
    <ChmodDialog name="deploy.sh" mode={0o4644} onApply={onApply} onClose={() => undefined} />,
  );
  const octal = screen.getByLabelText('Mode octal');
  expect(octal).toHaveValue('644');
  expect(screen.getByRole('checkbox', { name: 'Propriétaire : exécution' })).not.toBeChecked();

  await userEvent.click(screen.getByRole('checkbox', { name: 'Propriétaire : exécution' }));
  expect(octal).toHaveValue('744');

  await userEvent.clear(octal);
  await userEvent.type(octal, '750');
  expect(screen.getByRole('checkbox', { name: 'Groupe : exécution' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Autres : lecture' })).not.toBeChecked();

  await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  // The setuid bit the dialog does not show is kept.
  expect(onApply).toHaveBeenCalledWith(0o4750);
});

test('an invalid octal value cannot be applied', async () => {
  render(<ChmodDialog name="x" mode={0o644} onApply={vi.fn()} onClose={() => undefined} />);
  const octal = screen.getByLabelText('Mode octal');
  await userEvent.clear(octal);
  await userEvent.type(octal, '9');
  expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
});
