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
import { SPACE_ICONS, type Space } from '@/ipc/connections';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import { useConnections } from '@/stores/connections';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { ColorPicker } from '../ColorPicker';
import { IconPicker } from '../IconPicker';

function SpaceForm({ space, onDone }: { space: Space | 'new'; onDone: () => void }) {
  const saveSpace = useConnections((s) => s.saveSpace);
  const initial: Space = space === 'new' ? { id: '', name: '', color: null, icon: null } : space;
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<string | null>(initial.color);
  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError('Le nom est obligatoire');
      return;
    }
    saveSpace({ ...initial, name: name.trim(), color, icon }).then(
      (saved) => {
        onDone();
        // A new space is where the user wants to go next.
        if (space === 'new') useWorkspace.getState().switchSpace(saved.id);
      },
      (e: unknown) => {
        setError(isConfigError(e) ? formatConfigError(e, 'connections.json') : String(e));
      },
    );
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{space === 'new' ? 'Nouvel espace' : 'Modifier l’espace'}</DialogTitle>
        <DialogDescription>
          Un espace regroupe ses connexions et ses sessions : Pro, Perso, Homelab…
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="space-name" className="text-sm">
          Nom de l’espace
        </label>
        <Input
          id="space-name"
          autoFocus
          value={name}
          placeholder="Pro"
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm">Couleur</span>
        <ColorPicker label="Couleur de l’espace" value={color} onChange={setColor} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm">Icône</span>
        <IconPicker
          label="Icône de l’espace"
          icons={SPACE_ICONS}
          value={icon ?? 'server'}
          color={color}
          onChange={setIcon}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit">{space === 'new' ? 'Créer' : 'Enregistrer'}</Button>
      </DialogFooter>
    </form>
  );
}

/** Creates or edits a space (`useUi.spaceDialog`). */
export function SpaceDialog() {
  const space = useUi((s) => s.spaceDialog);
  const close = () => {
    useUi.getState().setSpaceDialog(null);
  };
  return (
    <Dialog
      open={space !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {space !== null && (
          <SpaceForm key={space === 'new' ? 'new' : space.id} space={space} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
