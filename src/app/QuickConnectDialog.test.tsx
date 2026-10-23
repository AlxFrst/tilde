import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SshHostEntry } from '@/ipc/ssh';
import { QuickConnectDialog } from './QuickConnectDialog';

const hosts: SshHostEntry[] = [
  { alias: 'prod', hostname: 'prod.example', user: 'deploy', port: 22 },
  { alias: 'staging', hostname: 'staging.example', user: 'deploy', port: 2222 },
];

function show() {
  const onConnect = vi.fn();
  render(
    <QuickConnectDialog
      open
      onOpenChange={() => undefined}
      onConnect={onConnect}
      loadHosts={() => Promise.resolve(hosts)}
    />,
  );
  return onConnect;
}

test('quick connect suggests ssh_config aliases and accepts user@host:port', async () => {
  const onConnect = show();
  const input = screen.getByRole('combobox', { name: 'Hôte SSH' });
  expect(await screen.findByRole('option', { name: /staging/ })).toBeInTheDocument();

  await userEvent.type(input, 'pro');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    expect.stringContaining('prod'),
  ]);
  await userEvent.keyboard('{Enter}');
  expect(onConnect).toHaveBeenLastCalledWith('prod');

  await userEvent.clear(input);
  await userEvent.type(input, 'root@db.example:2222{Enter}');
  expect(onConnect).toHaveBeenLastCalledWith('root@db.example:2222');
});

test('an invalid target is not opened', async () => {
  const onConnect = show();
  await userEvent.type(screen.getByRole('combobox', { name: 'Hôte SSH' }), 'a b{Enter}');
  expect(onConnect).not.toHaveBeenCalled();
  expect(screen.getByText(/Hôte invalide/)).toBeInTheDocument();
});
