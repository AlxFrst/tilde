import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  Link2,
  Link2Off,
  RotateCw,
  Unplug,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/app/confirm';
import { Button } from '@/components/ui/button';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  joinRemote,
  onTransfer,
  parentOf,
  sftpChmod,
  sftpDownload,
  sftpEdit,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpUpload,
  type RemoteEntry,
} from '@/ipc/sftp';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { useSsh } from '@/stores/ssh';
import { useWorkspace } from '@/stores/workspace';
import { useSessionId } from '@/terminal/sessionRegistry';
import { findLeaf } from '@/workspace/tree';
import type { SftpPanel } from '@/workspace/types';
import { previewKind } from '@/panels/preview/previewKind';
import { ChmodDialog } from './ChmodDialog';
import { FileList, sortEntries, type Sort } from './FileList';
import { OSC7_SNIPPETS } from './osc7Snippet';
import { PathBar } from './PathBar';

/** How long to wait for the shell to report its directory before offering the snippet. */
const OSC7_GRACE_MS = 3000;

function message(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String(err.message);
  }
  return String(err);
}

/** Asks for a name (new folder, rename). */
function NameDialog({
  title,
  initial,
  onDone,
}: {
  title: string;
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim() !== '' && !name.includes('/');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onDone(name.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Nom"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
            }}
            onFocus={(e) => {
              const dot = e.currentTarget.value.lastIndexOf('.');
              e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onDone(null);
              }}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={!valid}>
              Valider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Osc7Banner({ onDetach }: { onDetach: () => void }) {
  const [shell, setShell] = useState(0);
  const snippet = OSC7_SNIPPETS[shell] ?? OSC7_SNIPPETS[0];
  return (
    <div className="m-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
      <p>
        Le shell distant ne signale pas son dossier courant : le panneau reste sur votre dossier
        personnel. Pour qu’il suive vos <code>cd</code>, ajoutez à <code>{snippet.file}</code> :
      </p>
      <div className="mt-1 flex gap-1">
        {OSC7_SNIPPETS.map((s, i) => (
          <button
            key={s.shell}
            type="button"
            className={cn('rounded px-1.5', i === shell ? 'bg-surface-2' : 'text-text-muted')}
            onClick={() => {
              setShell(i);
            }}
          >
            {s.shell}
          </button>
        ))}
      </div>
      <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono select-text">
        {snippet.code}
      </pre>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="underline"
          onClick={() => {
            void writeText(snippet.code).then(() => toast.success('Copié'));
          }}
        >
          Copier
        </button>
        <button type="button" className="underline" onClick={onDetach}>
          Ne pas suivre le terminal
        </button>
      </div>
    </div>
  );
}

/** The files (SFTP) of the SSH session running in `panel.linkedLeafId`. */
export function SftpPanelView({
  tabId,
  leafId,
  panel,
  active,
}: {
  tabId: string;
  leafId: string;
  panel: SftpPanel;
  active: boolean;
}) {
  const sessionId = useSessionId(panel.linkedLeafId);
  const linkedCwd = useWorkspace((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    const linked = tab ? findLeaf(tab.root, panel.linkedLeafId) : null;
    return linked?.panel.kind === 'ssh' ? linked.panel.cwd : null;
  });
  const ready = useSsh((s) => s.states[panel.linkedLeafId]?.kind === 'ready');
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true });
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [naming, setNaming] = useState<
    { kind: 'mkdir' } | { kind: 'rename'; entry: RemoteEntry } | null
  >(null);
  const [chmod, setChmod] = useState<RemoteEntry | null>(null);
  const [noOsc7, setNoOsc7] = useState(false);
  const [dropping, setDropping] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const path = panel.path;
  const update = useCallback(
    (patch: { path?: string; follow?: boolean }) => {
      useWorkspace.getState().updatePanel(tabId, leafId, patch);
    },
    [tabId, leafId],
  );
  const refresh = () => {
    setReload((r) => r + 1);
  };
  const navigate = (to: string) => {
    // Browsing by hand detaches the pane from the terminal's directory.
    update({ path: to, follow: false });
    setSelected(new Set());
  };

  // First directory: the terminal's (when following and known), else home.
  useEffect(() => {
    if (sessionId === null || path !== null) return;
    if (panel.follow && linkedCwd) {
      update({ path: linkedCwd });
      return;
    }
    sftpHome(sessionId).then(
      (home) => {
        update({ path: home });
      },
      (e: unknown) => {
        setError(message(e));
      },
    );
  }, [sessionId, path, panel.follow, linkedCwd, update]);

  // Follow the terminal's `cd`.
  useEffect(() => {
    if (panel.follow && linkedCwd && linkedCwd !== path) update({ path: linkedCwd });
  }, [panel.follow, linkedCwd, path, update]);

  // No OSC 7 from the shell after a while: offer the snippet.
  const waitingForCwd = panel.follow && ready && !linkedCwd;
  useEffect(() => {
    if (!waitingForCwd) return;
    const timer = setTimeout(() => {
      setNoOsc7(true);
    }, OSC7_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setNoOsc7(false);
    };
  }, [waitingForCwd]);

  useEffect(() => {
    if (sessionId === null || path === null) return;
    let cancelled = false;
    sftpList(sessionId, path).then(
      (list) => {
        if (cancelled) return;
        setEntries(list);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(message(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, reload]);

  // Uploads landing in this folder show up as they finish.
  useEffect(() => {
    const off = onTransfer((t) => {
      if (
        t.session === sessionId &&
        t.direction === 'upload' &&
        t.state.kind === 'done' &&
        path !== null &&
        parentOf(t.remote) === path
      ) {
        setReload((r) => r + 1);
      }
    });
    return () => {
      void off.then((f) => {
        f();
      });
    };
  }, [sessionId, path]);

  // Files dropped from the system onto this pane are uploaded here.
  useEffect(() => {
    if (sessionId === null || path === null) return;
    const inside = (x: number, y: number) => {
      const r = root.current?.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const [cx, cy] = [x / scale, y / scale];
      return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    const off = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === 'over') setDropping(inside(p.position.x, p.position.y));
      else if (p.type === 'leave') setDropping(false);
      else if (p.type === 'drop') {
        setDropping(false);
        if (inside(p.position.x, p.position.y) && p.paths.length > 0) {
          sftpUpload(sessionId, p.paths, path).catch((err: unknown) => toast.error(message(err)));
        }
      }
    });
    return () => {
      void off.then((f) => {
        f();
      });
    };
  }, [sessionId, path]);

  const visible = useMemo(
    () =>
      sortEntries(
        (entries ?? []).filter((e) => showHidden || !e.name.startsWith('.')),
        sort,
      ),
    [entries, showHidden, sort],
  );
  const targetsOf = (e: RemoteEntry) =>
    selected.has(e.path) ? visible.filter((v) => selected.has(v.path)) : [e];

  if (sessionId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-6 text-center text-text-muted">
        <Unplug className="size-5" strokeWidth={1.5} />
        <p>Déconnecté — reconnectez l’onglet SSH pour voir ses fichiers.</p>
      </div>
    );
  }

  const run = (p: Promise<unknown>, done?: string) => {
    p.then(
      () => {
        if (done) toast.success(done);
        refresh();
      },
      (e: unknown) => toast.error(message(e)),
    );
  };
  const open = (e: RemoteEntry) => {
    if (e.kind === 'dir' || e.kind === 'symlink') navigate(e.path);
    else run(sftpDownload(sessionId, [e.path], false));
  };
  const remove = (e: RemoteEntry) => {
    const targets = targetsOf(e);
    const one = targets.length === 1 ? targets[0] : undefined;
    void confirmAction({
      title: one ? `Supprimer « ${one.name} » ?` : `Supprimer ${String(targets.length)} éléments ?`,
      description: !one
        ? 'Les dossiers sont supprimés avec tout leur contenu ; les liens symboliques, sans toucher à leur cible.'
        : one.kind === 'dir'
          ? 'Le dossier sera supprimé du serveur, et tout son contenu. Les liens symboliques qu’il contient sont supprimés sans toucher à leur cible.'
          : 'Le fichier sera supprimé du serveur.',
      confirmLabel: 'Supprimer',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      run(Promise.all(targets.map((t) => sftpRemove(sessionId, t.path))));
    });
  };

  const menu = (e: RemoteEntry) => {
    const targets = targetsOf(e);
    return (
      <ContextMenuContent className="min-w-52">
        {e.kind === 'dir' ? (
          <ContextMenuItem
            onSelect={() => {
              navigate(e.path);
            }}
          >
            Ouvrir
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => {
              if (useSettings.getState().settings?.sftp.editorMode === 'builtin') {
                useWorkspace.getState().openEditor(leafId, {
                  kind: 'remote',
                  linkedLeafId: panel.linkedLeafId,
                  path: e.path,
                });
              } else run(sftpEdit(sessionId, e.path));
            }}
          >
            Modifier
          </ContextMenuItem>
        )}
        {e.kind !== 'dir' && previewKind(e.name) && (
          <ContextMenuItem
            onSelect={() => {
              useWorkspace.getState().openPreview(leafId, {
                kind: 'remote',
                linkedLeafId: panel.linkedLeafId,
                path: e.path,
              });
            }}
          >
            Aperçu
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => {
            run(
              sftpDownload(
                sessionId,
                targets.map((t) => t.path),
                false,
              ),
            );
          }}
        >
          Télécharger
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            run(
              sftpDownload(
                sessionId,
                targets.map((t) => t.path),
                true,
              ),
            );
          }}
        >
          Télécharger vers…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            setNaming({ kind: 'rename', entry: e });
          }}
        >
          Renommer…
        </ContextMenuItem>
        {/* SETSTAT follows links: changing a link's « mode » would change its target. */}
        {e.kind !== 'symlink' && (
          <ContextMenuItem
            disabled={e.permissions === null}
            onSelect={() => {
              setChmod(e);
            }}
          >
            Permissions…
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => {
            void writeText(e.path);
          }}
        >
          Copier le chemin
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            remove(e);
          }}
        >
          Supprimer
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const tool =
    'flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text';

  return (
    <div
      ref={root}
      className={cn(
        'flex h-full flex-col bg-background',
        active && 'outline-none',
        dropping && 'ring-2 ring-primary ring-inset',
      )}
    >
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <button
          type="button"
          aria-label="Dossier parent"
          title="Dossier parent (Retour arrière)"
          className={tool}
          onClick={() => {
            if (path) navigate(parentOf(path));
          }}
        >
          <ArrowUp className="size-4" strokeWidth={1.5} />
        </button>
        {path !== null && <PathBar path={path} onNavigate={navigate} />}
        <button type="button" aria-label="Actualiser" className={tool} onClick={refresh}>
          <RotateCw className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={panel.follow ? 'Ne pas suivre le terminal' : 'Suivre le terminal'}
          aria-pressed={panel.follow}
          title={panel.follow ? 'Suit le dossier du terminal' : 'Ne suit pas le terminal'}
          className={cn(tool, panel.follow && 'text-primary')}
          onClick={() => {
            update({ follow: !panel.follow });
          }}
        >
          {panel.follow ? (
            <Link2 className="size-4" strokeWidth={1.5} />
          ) : (
            <Link2Off className="size-4" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          aria-label={showHidden ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés'}
          className={tool}
          onClick={() => {
            setShowHidden((v) => !v);
          }}
        >
          {showHidden ? (
            <Eye className="size-4" strokeWidth={1.5} />
          ) : (
            <EyeOff className="size-4" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          aria-label="Nouveau dossier"
          className={tool}
          onClick={() => {
            setNaming({ kind: 'mkdir' });
          }}
        >
          <FolderPlus className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Envoyer des fichiers"
          title="Envoyer des fichiers (ou glissez-les ici)"
          className={tool}
          onClick={() => {
            if (path) run(sftpUpload(sessionId, null, path));
          }}
        >
          <Upload className="size-4" strokeWidth={1.5} />
        </button>
      </div>

      {noOsc7 && (
        <Osc7Banner
          onDetach={() => {
            update({ follow: false });
          }}
        />
      )}
      {error && <p className="m-2 rounded-md bg-destructive/10 p-2 text-xs text-error">{error}</p>}

      <FileList
        entries={visible}
        sort={sort}
        onSort={(key) => {
          setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));
        }}
        selected={selected}
        onSelect={(e, how) => {
          setSelected((current) => {
            if (how === 'toggle') {
              const next = new Set(current);
              if (next.has(e.path)) next.delete(e.path);
              else next.add(e.path);
              return next;
            }
            if (how === 'range' && anchor) {
              const paths = visible.map((v) => v.path);
              const from = paths.indexOf(anchor);
              const to = paths.indexOf(e.path);
              return new Set(paths.slice(Math.min(from, to), Math.max(from, to) + 1));
            }
            return new Set([e.path]);
          });
          if (how !== 'range') setAnchor(e.path);
        }}
        onOpen={open}
        onUp={() => {
          if (path) navigate(parentOf(path));
        }}
        onDelete={remove}
        onRename={(e) => {
          setNaming({ kind: 'rename', entry: e });
        }}
        menu={menu}
      />

      {naming && path !== null && (
        <NameDialog
          title={naming.kind === 'mkdir' ? 'Nouveau dossier' : 'Renommer'}
          initial={naming.kind === 'rename' ? naming.entry.name : ''}
          onDone={(name) => {
            const current = naming;
            setNaming(null);
            if (!name) return;
            if (current.kind === 'mkdir') run(sftpMkdir(sessionId, joinRemote(path, name)));
            else run(sftpRename(sessionId, current.entry.path, joinRemote(path, name)));
          }}
        />
      )}
      {chmod?.permissions != null && (
        <ChmodDialog
          name={chmod.name}
          mode={chmod.permissions}
          onClose={() => {
            setChmod(null);
          }}
          onApply={(mode) => {
            const target = chmod;
            setChmod(null);
            run(sftpChmod(sessionId, target.path, mode));
          }}
        />
      )}
    </div>
  );
}
