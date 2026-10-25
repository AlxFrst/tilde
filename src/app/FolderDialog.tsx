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
import { t } from '@/i18n';
import { formatConfigError, isConfigError } from '@/ipc/errors';
import type { Folder } from '@/ipc/connections';
import { listSpaces, spaceIdOf, spaceName } from '@/connections/spaces';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import { ColorPicker } from './ColorPicker';

function FolderForm({ folder, onDone }: { folder: Folder | 'new'; onDone: () => void }) {
  const saveFolder = useConnections((s) => s.saveFolder);
  const file = useConnections((s) => s.file);
  const activeSpace = useWorkspace((s) => s.activeSpaceId);
  const spaces = listSpaces(file);
  // A new folder goes in the space shown.
  const initial: Folder =
    folder === 'new' ? { id: '', name: '', color: null, spaceId: activeSpace } : folder;
  const [spaceId, setSpaceId] = useState(spaceIdOf(initial, spaces));
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<string | null>(initial.color);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError(t('Le nom est obligatoire'));
      return;
    }
    const stored = file.spaces.length === 0 ? null : spaceId;
    saveFolder({ ...initial, name: name.trim(), color, spaceId: stored }).then(
      onDone,
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
        <DialogTitle>
          {folder === 'new' ? t('Nouveau dossier') : t('Renommer le dossier')}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="folder-name" className="text-sm">
          {t('Nom du dossier')}
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
      {spaces.length > 1 && (
        <div className="grid gap-1.5">
          <label htmlFor="folder-space" className="text-sm">
            {t('Espace du dossier')}
          </label>
          <select
            id="folder-space"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            value={spaceId}
            onChange={(e) => {
              setSpaceId(e.currentTarget.value);
            }}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {spaceName(s)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-1.5">
        <span className="text-sm">{t('Couleur')}</span>
        <ColorPicker label={t('Couleur du dossier')} value={color} onChange={setColor} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Annuler')}
        </Button>
        <Button type="submit">{t('Enregistrer')}</Button>
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
