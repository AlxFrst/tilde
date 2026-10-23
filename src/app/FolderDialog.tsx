import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import type { Folder } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { ColorPicker } from './ColorPicker';

function FolderForm({ folder, onDone }: { folder: Folder | 'new'; onDone: () => void }) {
  const saveFolder = useConnections((s) => s.saveFolder);
  const initial = folder === 'new' ? { id: '', name: '', color: null } : folder;
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<string | null>(initial.color);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError('Le nom est obligatoire');
      return;
    }
    saveFolder({ ...initial, name: name.trim(), color }).then(onDone, (e: unknown) => {
      setError(isConfigError(e) ? formatConfigError(e, 'connections.json') : String(e));
    });
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
        <DialogTitle>{folder === 'new' ? 'Nouveau dossier' : 'Renommer le dossier'}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="folder-name" className="text-sm">
          Nom du dossier
        </label>
        <Input
          id="folder-name"
          autoFocus
          value={name}
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
        <ColorPicker label="Couleur du dossier" value={color} onChange={setColor} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit">Enregistrer</Button>
      </DialogFooter>
    </form>
  );
}

/** Creates or renames a folder (`useConnections.editingFolder`). */
export function FolderDialog() {
  const folder = useConnections((s) => s.editingFolder);
  const setEditingFolder = useConnections((s) => s.setEditingFolder);
  const close = () => {
    setEditingFolder(null);
  };
  return (
    <Dialog
      open={folder !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        {folder !== null && (
          <FolderForm key={folder === 'new' ? 'new' : folder.id} folder={folder} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
