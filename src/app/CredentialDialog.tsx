import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import type { PromptReply, SshPrompt } from '@/ipc/ssh';

export type CredentialPromptData = Extract<SshPrompt, { kind: 'secret' | 'keyboardInteractive' }>;

const MAX_ATTEMPTS = 3;

/**
 * A password, a key passphrase, or keyboard-interactive questions (OTP, 2FA…). The
 * questions, their name and instructions are written by the server: never translated.
 */
export function CredentialDialog({
  prompt,
  onAnswer,
}: {
  prompt: CredentialPromptData;
  onAnswer: (reply: PromptReply) => void;
}) {
  const questions =
    prompt.kind === 'secret'
      ? [
          {
            text: prompt.secret === 'passphrase' ? t('Phrase secrète') : t('Mot de passe'),
            echo: false,
          },
        ]
      : prompt.questions;
  const [answers, setAnswers] = useState(() => questions.map(() => ''));
  const [remember, setRemember] = useState(false);

  const submit = () => {
    if (prompt.kind === 'secret') {
      onAnswer({ kind: 'secret', value: answers[0] ?? '', remember });
    } else {
      onAnswer({ kind: 'keyboardInteractive', answers });
    }
  };

  const title =
    prompt.kind === 'keyboardInteractive'
      ? prompt.name || t('Vérification pour {target}', { target: prompt.target })
      : prompt.secret === 'password'
        ? t('Mot de passe pour {target}', { target: prompt.target })
        : prompt.secret === 'sudo'
          ? t('Mot de passe sudo pour {target}', { target: prompt.target })
          : t('Phrase secrète de la clé');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onAnswer({ kind: 'cancel' });
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" strokeWidth={1.5} />
              {title}
            </DialogTitle>
            <DialogDescription>
              {prompt.kind === 'keyboardInteractive'
                ? prompt.instructions || prompt.target
                : prompt.secret === 'passphrase'
                  ? t('{key} — pour {target}', { key: prompt.keyPath ?? '', target: prompt.target })
                  : prompt.secret === 'sudo'
                    ? t(
                        'Le mot de passe que sudo demande (en général le vôtre), pour lire et écrire les fichiers en tant que {user}.',
                        { user: prompt.sudoUser ?? 'root' },
                      )
                    : t('Le mot de passe n’est jamais écrit sur le disque ni dans les journaux.')}
              {prompt.kind === 'secret' && prompt.attempt > 1 && (
                <span className="block text-warning">
                  {t('Refusé. Tentative {attempt}/{max}', {
                    attempt: prompt.attempt,
                    max: MAX_ATTEMPTS,
                  })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {questions.map((q, i) => {
            const id = `credential-${String(prompt.id)}-${String(i)}`;
            return (
              <div key={id} className="grid gap-1.5">
                <label htmlFor={id} className="text-sm">
                  {q.text}
                </label>
                <Input
                  id={id}
                  type={q.echo ? 'text' : 'password'}
                  autoComplete="off"
                  autoFocus={i === 0}
                  value={answers[i] ?? ''}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setAnswers((a) => a.map((old, j) => (j === i ? value : old)));
                  }}
                />
              </div>
            );
          })}

          {prompt.kind === 'secret' && (
            <div className="grid gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={!prompt.canRemember}
                  onChange={(e) => {
                    setRemember(e.currentTarget.checked);
                  }}
                />
                {t('Mémoriser dans le trousseau')}
              </label>
              {!prompt.canRemember && (
                <p className="text-xs text-text-muted">
                  {t('Aucun trousseau système disponible : rien ne sera enregistré.')}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onAnswer({ kind: 'cancel' });
              }}
            >
              {t('Annuler')}
            </Button>
            <Button type="submit">
              {prompt.kind === 'secret' && prompt.secret === 'sudo'
                ? t('Valider')
                : t('Se connecter')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
