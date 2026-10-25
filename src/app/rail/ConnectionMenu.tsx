import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { connectionSpace, listSpaces, spaceIdOf, spaceName } from '@/connections/spaces';
import { t } from '@/i18n';
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
        {session ? t('Afficher la session') : t('Ouvrir')}
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          useWorkspace.getState().openSshTab(c.host, c.id);
        }}
      >
        {t('Ouvrir une autre session')}
      </ContextMenuItem>
      {session && (
        <>
          <ContextMenuItem
            onSelect={() => {
              useWorkspace.getState().unpinTab(session.id);
            }}
          >
            {t('Désépingler la session')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void closeTab(session.id)}>
            {t('Fermer la session')}
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
        {t('Modifier…')}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void save({ ...c, id: '', name: t('{name} (copie)', { name: c.name }), favorite: false });
        }}
      >
        {t('Dupliquer')}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => {
          void setFavorite(c.id, !c.favorite);
        }}
      >
        {c.favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={readOnly}>{t('Ranger dans')}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            disabled={c.folderId === null}
            onSelect={() => {
              void save({ ...c, folderId: null, spaceId: space });
            }}
          >
            {t('Sans dossier')}
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
      {spaces.length > 1 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={readOnly}>
            {t('Déplacer vers l’espace')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {spaces.map((s) => (
              <ContextMenuItem
                key={s.id}
                disabled={s.id === space}
                onSelect={() => {
                  void save({ ...c, spaceId: s.id });
                }}
              >
                {spaceName(s)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={readOnly}
        onSelect={() => {
          void confirmAction({
            title: t('Supprimer « {name} » ?', { name: c.name }),
            description: t('Les sessions déjà ouvertes restent connectées.'),
            confirmLabel: t('Supprimer'),
            destructive: true,
          }).then((ok) => (ok ? remove(c.id) : undefined));
        }}
      >
        {t('Supprimer')}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
