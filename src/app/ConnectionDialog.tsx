import { useState, type ReactNode } from 'react';
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
import {
  parseTags,
  validateConnection,
  type ConnectionForm,
  type FormErrors,
} from '@/connections/validate';
import { CONNECTION_ICONS, type Connection } from '@/ipc/connections';
import { connectionSpace, listSpaces, spaceIdOf } from '@/connections/spaces';
import { isConfigError } from '@/ipc/errors';
import { cn } from '@/lib/utils';
import { blankConnection, useConnections } from '@/stores/connections';
import { openConnection } from './actions';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';
import { JumpHosts } from './JumpHosts';

const AGENT = [
  ['', 'Selon ~/.ssh/config'],
  ['yes', 'Oui'],
  ['no', 'Non'],
] as const;

function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid content-start gap-1', className)}>
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : (
        hint && <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

function ConnectionFormView({ initial, onDone }: { initial: Connection; onDone: () => void }) {
  const { file, sshHosts, save } = useConnections();
  const [form, setForm] = useState<ConnectionForm>({
    name: initial.name,
    host: initial.host,
    port: initial.port === null ? '' : String(initial.port),
    user: initial.user ?? '',
    identityFile: initial.identityFile ?? '',
    proxyJump: initial.proxyJump ?? '',
  });
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [folderId, setFolderId] = useState(initial.folderId);
  const spaces = listSpaces(file);
  const [spaceId, setSpaceId] = useState(() =>
    initial.id ? connectionSpace(initial, file) : spaceIdOf(initial, spaces),
  );
  const spaceFolders = file.folders.filter((f) => spaceIdOf(f, spaces) === spaceId);
  const [color, setColor] = useState(initial.color);
  const [icon, setIcon] = useState(initial.icon);
  const [agent, setAgent] = useState(
    initial.forwardAgent === null ? '' : initial.forwardAgent ? 'yes' : 'no',
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ConnectionForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const alias = sshHosts.find((h) => h.alias === form.host.trim());
  const opt = (s: string) => (s.trim() ? s.trim() : null);

  const submit = (connect: boolean) => {
    const found = validateConnection(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    const connection: Connection = {
      ...initial,
      name: form.name.trim(),
      host: form.host.trim(),
      port: form.port.trim() ? Number(form.port) : null,
      user: opt(form.user),
      identityFile: opt(form.identityFile),
      proxyJump: opt(form.proxyJump),
      forwardAgent: agent === '' ? null : agent === 'yes',
      folderId: spaceFolders.some((f) => f.id === folderId) ? folderId : null,
      // While no space is written, everything stays in the implicit one (null).
      spaceId: file.spaces.length === 0 ? null : spaceId,
      color,
      icon,
      tags: parseTags(tags),
    };
    setBusy(true);
    save(connection).then(
      (saved) => {
        setBusy(false);
        onDone();
        if (connect) openConnection(saved);
      },
      (e: unknown) => {
        setBusy(false);
        if (isConfigError(e) && e.kind === 'invalid' && e.path && e.path in form) {
          setErrors({ [e.path]: e.message });
        } else {
          setFailure(isConfigError(e) ? e.message : String(e));
        }
      },
    );
  };

  const input = (key: keyof ConnectionForm, props: React.ComponentProps<'input'> = {}) => (
    <Input
      id={`conn-${key}`}
      value={form[key]}
      aria-invalid={errors[key] !== undefined}
      spellCheck={false}
      autoComplete="off"
      onChange={set(key)}
      {...props}
    />
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {initial.id ? `Modifier « ${initial.name} »` : 'Nouvelle connexion'}
        </DialogTitle>
        <DialogDescription>
          Aucun mot de passe n’est enregistré ici : ils restent dans le trousseau du système.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-6 gap-3">
        <Field id="conn-name" label="Nom" error={errors.name} className="col-span-6">
          {input('name', { autoFocus: true, placeholder: 'Base de prod' })}
        </Field>
        <Field
          id="conn-host"
          label="Hôte"
          error={errors.host}
          className="col-span-4"
          hint={
            alias
              ? 'Les réglages de ~/.ssh/config pour cet alias s’appliquent ; les champs remplis ici les remplacent.'
              : 'Nom, IP ou alias de ~/.ssh/config'
          }
        >
          {input('host', { placeholder: 'db.example.com' })}
        </Field>
        <Field id="conn-port" label="Port" error={errors.port} className="col-span-2">
          {input('port', { inputMode: 'numeric', placeholder: alias ? String(alias.port) : '22' })}
        </Field>
        <Field id="conn-user" label="Utilisateur" error={errors.user} className="col-span-3">
          {input('user', { placeholder: alias?.user ?? '' })}
        </Field>
        <Field
          id="conn-identityFile"
          label="Clé"
          error={errors.identityFile}
          className="col-span-3"
        >
          {input('identityFile', { placeholder: '~/.ssh/id_ed25519' })}
        </Field>
        <Field
          id="conn-proxyJump"
          label="Rebonds (ProxyJump)"
          error={errors.proxyJump}
          className="col-span-6"
          hint="Tilde passe par chaque bastion dans l’ordre, puis se connecte à l’hôte ; les fichiers et le bandeau d’état suivent le même chemin."
        >
          <JumpHosts
            value={form.proxyJump}
            invalid={errors.proxyJump !== undefined}
            connections={file.connections.filter((c) => c.id !== initial.id || !initial.id)}
            sshHosts={sshHosts}
            onChange={(proxyJump) => {
              setForm((f) => ({ ...f, proxyJump }));
              setErrors((er) => ({ ...er, proxyJump: undefined }));
            }}
          />
        </Field>
        {spaces.length > 1 && (
          <Field id="conn-space" label="Espace" className="col-span-6">
            <select
              id="conn-space"
              className={selectClass}
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.currentTarget.value);
                setFolderId(null);
              }}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="conn-folder" label="Dossier" className="col-span-2">
          <select
            id="conn-folder"
            className={selectClass}
            value={folderId ?? ''}
            onChange={(e) => {
              setFolderId(e.currentTarget.value || null);
            }}
          >
            <option value="">Sans dossier</option>
            {spaceFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="conn-agent" label="Transférer l’agent" className="col-span-2">
          <select
            id="conn-agent"
            className={selectClass}
            value={agent}
            onChange={(e) => {
              setAgent(e.currentTarget.value);
            }}
          >
            {AGENT.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="conn-tags" label="Tags" className="col-span-2" hint="Séparés par des virgules">
          <Input
            id="conn-tags"
            value={tags}
            onChange={(e) => {
              setTags(e.currentTarget.value);
            }}
          />
        </Field>
        <div className="col-span-6 grid gap-1">
          <span className="text-sm">Couleur</span>
          <ColorPicker label="Couleur de la connexion" value={color} onChange={setColor} />
        </div>
        <div className="col-span-6 grid gap-1">
          <span className="text-sm">Icône</span>
          <IconPicker
            label="Icône"
            icons={CONNECTION_ICONS}
            value={icon ?? 'server'}
            color={color}
            onChange={(name) => {
              setIcon(name === 'server' ? null : name);
            }}
          />
        </div>
      </div>

      {failure && <p className="text-sm text-error">{failure}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            submit(true);
          }}
        >
          Enregistrer et se connecter
        </Button>
        <Button type="submit" disabled={busy}>
          Enregistrer
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Creates or edits a saved connection (`useConnections.editing`). */
export function ConnectionDialog() {
  const editing = useConnections((s) => s.editing);
  const setEditing = useConnections((s) => s.setEditing);
  const close = () => {
    setEditing(null);
  };
  const initial = editing === 'new' ? null : editing;
  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {editing !== null && (
          <ConnectionFormView
            key={initial?.id || 'new'}
            initial={initial ?? blankConnection()}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
