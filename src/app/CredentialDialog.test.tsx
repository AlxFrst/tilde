import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialDialog, type CredentialPromptData } from './CredentialDialog';

const password: CredentialPromptData = {
  id: 1,
  kind: 'secret',
  secret: 'password',
  keyPath: null,
  target: 'alice@db',
  attempt: 2,
  canRemember: true,
};

function show(prompt: CredentialPromptData) {
  const onAnswer = vi.fn();
  render(<CredentialDialog prompt={prompt} onAnswer={onAnswer} />);
  return onAnswer;
}

test('password is sent with the remember choice, attempt shown', async () => {
  const onAnswer = show(password);
  expect(screen.getByText(/Tentative 2\/3/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'pw');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Mémoriser dans le trousseau' }));
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(onAnswer).toHaveBeenCalledWith({ kind: 'secret', value: 'pw', remember: true });
});

test('credential dialog disables remember when the keyring is unavailable', () => {
  show({ ...password, canRemember: false });
  expect(screen.getByRole('checkbox', { name: 'Mémoriser dans le trousseau' })).toBeDisabled();
  expect(screen.getByText(/Aucun trousseau système/)).toBeInTheDocument();
});

test('keyboard-interactive questions hide answers unless echo is set', async () => {
  const onAnswer = show({
    id: 2,
    kind: 'keyboardInteractive',
    target: 'alice@db',
    name: '2FA',
    instructions: 'Code de votre application',
    questions: [
      { text: 'Utilisateur :', echo: true },
      { text: 'Code :', echo: false },
    ],
  });
  const user = screen.getByLabelText('Utilisateur :');
  const code = screen.getByLabelText('Code :');
  expect(user).toHaveAttribute('type', 'text');
  expect(code).toHaveAttribute('type', 'password');
  await userEvent.type(user, 'alice');
  await userEvent.type(code, '123456{Enter}');
  expect(onAnswer).toHaveBeenCalledWith({
    kind: 'keyboardInteractive',
    answers: ['alice', '123456'],
  });
});

test('cancel answers cancel', async () => {
  const onAnswer = show(password);
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onAnswer).toHaveBeenCalledWith({ kind: 'cancel' });
});

test('a sudo password says what it is for', async () => {
  const onAnswer = show({ ...password, secret: 'sudo', sudoUser: 'root', attempt: 1 });
  expect(
    screen.getByRole('heading', { name: /Mot de passe sudo pour alice@db/ }),
  ).toBeInTheDocument();
  expect(screen.getByText(/en tant que root/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(onAnswer).toHaveBeenCalledWith({ kind: 'secret', value: 'pw', remember: false });
});
