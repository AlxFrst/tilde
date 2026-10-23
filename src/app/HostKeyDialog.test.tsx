import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SshPrompt } from '@/ipc/ssh';
import { HostKeyDialog, type HostKeyPromptData } from './HostKeyDialog';

const base: Extract<SshPrompt, { kind: 'hostKey' }> = {
  id: 1,
  kind: 'hostKey',
  host: 'db.example',
  port: 2222,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:new',
  changed: null,
};

function show(prompt: HostKeyPromptData) {
  const onAnswer = vi.fn();
  render(<HostKeyDialog prompt={prompt} onAnswer={onAnswer} />);
  return onAnswer;
}

test('unknown host: trust and save is offered with the fingerprint', async () => {
  const onAnswer = show(base);
  expect(screen.getByText('SHA256:new')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Faire confiance et enregistrer' }));
  expect(onAnswer).toHaveBeenCalledWith('acceptAndSave');
});

test('host key dialog defaults to cancel for a changed key and needs the risk checkbox', async () => {
  const onAnswer = show({
    ...base,
    changed: { file: '/home/me/.ssh/known_hosts', line: 12, oldFingerprint: 'SHA256:old' },
  });
  expect(screen.getByText('SHA256:old')).toBeInTheDocument();
  expect(screen.getByText('/home/me/.ssh/known_hosts:12')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
  const replace = screen.getByRole('button', { name: 'Remplacer et continuer' });
  expect(replace).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Faire confiance et enregistrer' })).toBeNull();

  await userEvent.click(screen.getByRole('checkbox', { name: 'Je comprends le risque' }));
  expect(replace).toBeEnabled();
  await userEvent.click(replace);
  expect(onAnswer).toHaveBeenCalledWith('replace');
});

test('closing the dialog rejects the key', async () => {
  const onAnswer = show(base);
  await userEvent.keyboard('{Escape}');
  expect(onAnswer).toHaveBeenCalledWith('reject');
});
