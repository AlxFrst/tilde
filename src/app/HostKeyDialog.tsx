import { ShieldAlert } from 'lucide-react';
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
import type { HostKeyChoice, SshPrompt } from '@/ipc/ssh';

export type HostKeyPromptData = Extract<SshPrompt, { kind: 'hostKey' }>;

const hostLabel = (p: HostKeyPromptData) =>
  p.port === 22 ? p.host : `${p.host}:${String(p.port)}`;

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <code className="rounded bg-surface-2 px-2 py-1 font-mono text-xs break-all select-text">
        {value}
      </code>
    </div>
  );
}

/** A server key that is new, or different from the one recorded in known_hosts. */
export function HostKeyDialog({
  prompt,
  onAnswer,
}: {
  prompt: HostKeyPromptData;
  onAnswer: (choice: HostKeyChoice) => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const { changed } = prompt;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onAnswer('reject');
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        {changed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="size-5" strokeWidth={1.5} />
                L’empreinte de {hostLabel(prompt)} a changé
              </DialogTitle>
              <DialogDescription>
                Le serveur ne présente plus la clé enregistrée. Quelqu’un intercepte peut-être la
                connexion. Ne continuez que si vous savez que la clé du serveur a été changée.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <Fingerprint label="Empreinte enregistrée" value={changed.oldFingerprint} />
              <Fingerprint
                label={`Nouvelle empreinte (${prompt.keyType})`}
                value={prompt.fingerprint}
              />
              <span className="text-xs text-text-muted">
                Enregistrée dans{' '}
                <code className="font-mono">{`${changed.file}:${String(changed.line)}`}</code>
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => {
                  setUnderstood(e.currentTarget.checked);
                }}
              />
              Je comprends le risque
            </label>
            <DialogFooter>
              <Button
                variant="outline"
                autoFocus
                onClick={() => {
                  onAnswer('reject');
                }}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                disabled={!understood}
                onClick={() => {
                  onAnswer('replace');
                }}
              >
                Remplacer et continuer
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Première connexion à {hostLabel(prompt)}</DialogTitle>
              <DialogDescription>
                Vérifiez que cette empreinte est bien celle du serveur avant de lui faire confiance.
              </DialogDescription>
            </DialogHeader>
            <Fingerprint label={`Empreinte (${prompt.keyType})`} value={prompt.fingerprint} />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  onAnswer('reject');
                }}
              >
                Annuler
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onAnswer('acceptOnce');
                }}
              >
                Une seule fois
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  onAnswer('acceptAndSave');
                }}
              >
                Faire confiance et enregistrer
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
