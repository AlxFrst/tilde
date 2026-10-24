import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { connectionSpace, listSpaces, spaceIdOf } from '@/connections/spaces';
import type { Connection } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useWorkspace } from '@/stores/workspace';
import type { Tab } from '@/workspace/types';
import { closeTab, openConnection } from '../actions';
import { confirmAction } from '../confirm';

/** Context menu of a saved connection (and of its pinned session, when it is open). */
export function ConnectionMenu({ c, session }: { c: Connection; session?: Tab }) {
  const { readOnly, file, save, remove, setFavorite, setEditing } = useConnections();
  const spaces = listSpaces(file);
  const space = connectionSpace(c, file);
  const folders = file.folders.filter((f) => spaceIdOf(f, spaces) === space);
  return (
    <ContextMenuContent className="min-w-52">
      <ContextMenuItem
        onSelect={() => {
          openConnection(c);
        }}
      >
        {session ? 'Afficher la session' : 'Ouvrir'}
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          useWorkspace.getState().openSshTab(c.host, c.id);
        }}
      >
        Ouvrir une autre session
      </ContextMenuItem>
      {session && (
        <>
          <ContextMenuItem
            onSelect={() => {
              useWorkspace.getState().unpinTab(session.id);
            }}
          >
            Désépingler la session
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void closeTab(session.id)}>
            Fermer la session
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          setEditing(c);
        }}
      >
        Modifier…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void save({ ...c, id: '', name: `${c.name} (copie)`, favorite: false });
        }}
      >
        Dupliquer
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void setFavorite(c.id, !c.favorite);
        }}
      >
        {c.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={readOnly}>Ranger dans</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            disabled={c.folderId === null}
            onSelect={() => {
              void save({ ...c, folderId: null, spaceId: space });
            }}
          >
            Sans dossier
          </ContextMenuItem>
          {folders.map((f) => (
            <ContextMenuItem
              key={f.id}
              disabled={c.folderId === f.id}
              onSelect={() => {
                void save({ ...c, folderId: f.id, spaceId: space });
              }}
            >
              {f.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={readOnly}
        onSelect={() => {
          void confirmAction({
            title: `Supprimer « ${c.name} » ?`,
            description: 'Les sessions déjà ouvertes restent connectées.',
            confirmLabel: 'Supprimer',
            destructive: true,
          }).then((ok) => (ok ? remove(c.id) : undefined));
        }}
      >
        Supprimer
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
