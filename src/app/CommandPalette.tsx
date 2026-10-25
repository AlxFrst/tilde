import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Command } from 'cmdk';
import { single } from 'fuzzysort';
import {
  Activity,
  ChevronRight,
  Columns2,
  Copy,
  FileCode2,
  FolderTree,
  History,
  Pencil,
  Plug,
  Plus,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  commandTitle,
  groupTitle,
  listCommands,
  runCommand,
  type Command as AppCommand,
} from '@/commands/registry';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { connectionIcon } from '@/connections/icons';
import { msg, t } from '@/i18n';
import { fold } from '@/connections/search';
import { listSpaces, spaceName } from '@/connections/spaces';
import type { Connection } from '@/ipc/connections';
import { useConnections } from '@/stores/connections';
import { useKeybindings } from '@/stores/keybindings';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';
import { bindingKeys } from '@/terminal/keyLabels';
import { activeTerminal } from '@/terminal/terminalActions';
import { knownSpaceIds, spaceOfTab } from '@/workspace/spaces';
import { leaves } from '@/workspace/tree';
import { openConnection } from './actions';
import { sessionTitle, useLabelNames } from './paneLabel';
import { describeTarget } from './sidebar/Section';
import { adoptedAliases } from './sidebar/SshConfigSection';

interface Target {
  key: string;
  label: string;
  /** Where it leads; « récent » (shown with t()) for a typed target used before. */
  detail: string;
  keywords: string[];
  /** What `ssh` is given: a saved connection's host, an alias, a typed target. */
  sshTarget: string;
  open: () => void;
  connection?: Connection;
  kind: 'connection' | 'sshConfig' | 'recent';
}

/** The command line that opens the same connection with OpenSSH. */
export function sshCommand(c: Pick<Connection, 'host' | 'user' | 'port' | 'proxyJump'>): string {
  const parts = ['ssh'];
  const jumps = c.proxyJump
    ?.split(',')
    .map((j) => j.trim())
    .filter(Boolean);
  if (jumps && jumps.length > 0) parts.push('-J', jumps.join(','));
  if (c.port && c.port !== 22) parts.push('-p', String(c.port));
  parts.push(c.user ? `${c.user}@${c.host}` : c.host);
  return parts.join(' ');
}

/** Recents first, then saved connections, then ~/.ssh/config hosts; each once. */
function useTargets(): Target[] {
  const { file, sshHosts } = useConnections();
  return useMemo(() => {
    const byId = new Map(file.connections.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: Target[] = [];
    const fromConnection = (c: Connection): Target => ({
      key: `conn:${c.id}`,
      label: c.name,
      detail: describeTarget(c),
      keywords: [c.host, c.user ?? '', ...c.tags],
      sshTarget: c.host,
      open: () => {
        openConnection(c);
      },
      connection: c,
      kind: 'connection',
    });
    const push = (target: Target) => {
      if (seen.has(target.key)) return;
      seen.add(target.key);
      out.push(target);
    };
    for (const r of file.recents) {
      const saved = r.key.startsWith('conn:') ? byId.get(r.key.slice(5)) : undefined;
      if (saved) push(fromConnection(saved));
      else if (r.key.startsWith('ssh:')) {
        const target = r.key.slice(4);
        push({
          key: r.key,
          label: target,
          detail: msg('récent'),
          keywords: [],
          sshTarget: target,
          open: () => {
            useWorkspace.getState().openSshTab(target);
          },
          kind: 'recent',
        });
      }
    }
    for (const c of file.connections) push(fromConnection(c));
    const adopted = adoptedAliases(file.connections);
    for (const h of sshHosts) {
      if (adopted.has(h.alias)) continue;
      push({
        key: `ssh:${h.alias}`,
        label: h.alias,
        detail: describeTarget({ host: h.hostname, user: h.user, port: h.port }),
        keywords: [h.hostname, h.user],
        sshTarget: h.alias,
        open: () => {
          useWorkspace.getState().openSshTab(h.alias);
        },
        kind: 'sshConfig',
      });
    }
    return out;
  }, [file, sshHosts]);
}

/** Opens a target, then hands its SSH pane to `then` (files, monitor). */
function openThen(target: Target, then: (sshLeafId: string) => void): void {
  target.open();
  const ws = useWorkspace.getState();
  const tab = ws.tabs.find((x) => x.id === ws.activeTabId);
  const ssh = tab ? leaves(tab.root).find((l) => l.panel.kind === 'ssh') : undefined;
  if (ssh) then(ssh.id);
}

interface Action {
  id: string;
  title: string;
  Icon: LucideIcon;
  run: () => void;
}

/** What can be done with a host (→ in the palette). */
function targetActions(target: Target): Action[] {
  const ws = () => useWorkspace.getState();
  const actions: Action[] = [
    { id: 'open', title: t('Se connecter'), Icon: Plug, run: target.open },
    {
      id: 'beside',
      title: t('Se connecter à côté'),
      Icon: Columns2,
      run: () => {
        ws().splitWithSsh(target.sshTarget, target.connection?.id ?? null);
      },
    },
    {
      id: 'files',
      title: t('Fichiers'),
      Icon: FolderTree,
      run: () => {
        openThen(target, (id) => {
          ws().openSftpBeside(id);
        });
      },
    },
    {
      id: 'monitor',
      title: t('Moniteur'),
      Icon: Activity,
      run: () => {
        openThen(target, (id) => {
          useUi.getState().setPeek({ sshLeafId: id });
        });
      },
    },
    {
      id: 'copy',
      title: t('Copier la commande ssh'),
      Icon: Copy,
      run: () => {
        const c = target.connection ?? {
          host: target.sshTarget,
          user: null,
          port: null,
          proxyJump: null,
        };
        writeText(sshCommand(c)).then(
          () => toast.success(t('Commande copiée')),
          () => toast.error(t('Impossible de copier la commande')),
        );
      },
    },
  ];
  const c = target.connection;
  if (c) {
    actions.push({
      id: 'edit',
      title: t('Modifier…'),
      Icon: Pencil,
      run: () => {
        useConnections.getState().setEditing(c);
      },
    });
  } else if (target.kind === 'sshConfig') {
    actions.push({
      id: 'adopt',
      title: t('Adopter (enregistrer dans Tilde)…'),
      Icon: Plus,
      run: () => {
        const { activeSpaceId } = useWorkspace.getState();
        const written = useConnections.getState().file.spaces.length > 0;
        void useConnections.getState().adopt(target.sshTarget, written ? activeSpaceId : null);
      },
    });
  }
  return actions;
}

function Shortcut({ command }: { command: AppCommand }) {
  const binding = useKeybindings((s) => s.effective[command.id] ?? null);
  if (!binding) return null;
  return (
    <span className="ml-auto flex gap-1">
      {bindingKeys(binding).map((k) => (
        <kbd
          key={k}
          className="rounded border bg-surface-2 px-1 font-mono text-[10px] text-text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Item values end with an id (cmdk needs them unique); it is never searched. */
const ID_SEPARATOR = '\u0000';
const keyOf = (value: string) => value.split(ID_SEPARATOR)[1] ?? '';

/** Same matching as the Library: case and accents ignored, best matches first. */
function paletteFilter(value: string, query: string, keywords?: string[]): number {
  const label = value.split(ID_SEPARATOR)[0] ?? '';
  const q = fold(query.trim());
  if (!q) return 1;
  const result = single(q, fold([label, ...(keywords ?? [])].join(' ')));
  return result ? Math.max(result.score, 0.001) : 0;
}

const itemClass =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-surface-2';
const groupClass =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-muted';

/**
 * Ctrl+Shift+P: connections, open sessions, spaces, then every command. → on a host lists
 * what can be done with it; ← goes back.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const targets = useTargets();
  const tabs = useWorkspace((s) => s.tabs);
  const file = useConnections((s) => s.file);
  const names = useLabelNames();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<Target | null>(null);
  // Read when the palette opens: commands registered later still show next time.
  const commands = useMemo(() => (open ? listCommands().filter((c) => !c.hidden) : []), [open]);
  // The spaces this window shows (the Quake console has only one).
  const spaces = listSpaces(file).filter((s) => knownSpaceIds().includes(s.id));

  // However the palette closes (Escape, Ctrl+Shift+P, a choice), typing goes back to the
  // terminal of the active pane.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      activeTerminal()?.focus();
      setQuery('');
      setPage(null);
    }
    wasOpen.current = open;
  }, [open]);

  const close = () => {
    setOpen(false);
  };
  const choose = (run: () => void) => {
    close();
    run();
  };
  const openActions = (target: Target) => {
    setPage(target);
    setQuery('');
  };
  const back = () => {
    setPage(null);
    setQuery('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          // Escape leaves a host's actions before it closes the palette.
          if (page) {
            e.preventDefault();
            back();
          }
        }}
      >
        <DialogTitle className="sr-only">{t('Palette de commandes')}</DialogTitle>
        <Command
          label={t('Palette de commandes')}
          loop
          filter={paletteFilter}
          value={selected}
          onValueChange={setSelected}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-text-muted" strokeWidth={1.5} />
            {page && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                {page.label}
                <ChevronRight className="size-3" strokeWidth={1.5} />
              </span>
            )}
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={
                page
                  ? t('Que faire avec ce serveur ?')
                  : t('Se connecter à… ou lancer une commande')
              }
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
              onKeyDown={(e) => {
                const input = e.currentTarget;
                const atEnd = input.selectionStart === input.value.length;
                if (e.key === 'ArrowRight' && !page && atEnd) {
                  const target = targets.find((x) => x.key === keyOf(selected));
                  if (target) {
                    e.preventDefault();
                    openActions(target);
                  }
                } else if (
                  page &&
                  input.selectionStart === 0 &&
                  (e.key === 'ArrowLeft' || (e.key === 'Backspace' && input.value === ''))
                ) {
                  e.preventDefault();
                  back();
                }
              }}
            />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-text-muted">
              {t('Aucun résultat')}
            </Command.Empty>
            {page ? (
              <Command.Group
                heading={t('Actions · {name}', { name: page.label })}
                className={groupClass}
              >
                {targetActions(page).map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`${a.title}${ID_SEPARATOR}action:${a.id}`}
                    className={itemClass}
                    onSelect={() => {
                      choose(a.run);
                    }}
                  >
                    <a.Icon className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
                    <span className="truncate">{a.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : (
              <>
                {targets.length > 0 && (
                  <Command.Group heading={t('Connexions')} className={groupClass}>
                    {targets.map((target) => {
                      const Icon =
                        target.kind === 'connection'
                          ? connectionIcon(target.connection?.icon)
                          : target.kind === 'recent'
                            ? History
                            : FileCode2;
                      return (
                        <Command.Item
                          key={target.key}
                          value={`${target.label}${ID_SEPARATOR}${target.key}`}
                          keywords={target.keywords}
                          className={itemClass}
                          onSelect={() => {
                            choose(target.open);
                          }}
                        >
                          <Icon
                            className="size-4 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: target.connection?.color ?? undefined }}
                          />
                          <span className="truncate">{target.label}</span>
                          <span className="ml-auto truncate text-xs text-text-muted">
                            {target.kind === 'recent' ? t(target.detail) : target.detail}
                          </span>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={t('Actions de {name}', { name: target.label })}
                            title={t('Actions (→)')}
                            className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-1 hover:text-text"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openActions(target);
                            }}
                          >
                            <ChevronRight className="size-3.5" strokeWidth={1.5} />
                          </button>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}
                {tabs.length > 0 && (
                  <Command.Group heading={t('Sessions')} className={groupClass}>
                    {tabs.map((tab) => {
                      const space = spaces.find((s) => s.id === spaceOfTab(tab));
                      return (
                        <Command.Item
                          key={tab.id}
                          value={`${sessionTitle(tab, names)}${ID_SEPARATOR}tab:${tab.id}`}
                          keywords={['session', space ? spaceName(space) : '']}
                          className={itemClass}
                          onSelect={() => {
                            choose(() => {
                              useWorkspace.getState().activateTab(tab.id);
                            });
                          }}
                        >
                          <span className="truncate">{sessionTitle(tab, names)}</span>
                          {spaces.length > 1 && space && (
                            <span className="ml-auto truncate text-xs text-text-muted">
                              {spaceName(space)}
                            </span>
                          )}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}
                {spaces.length > 1 && (
                  <Command.Group heading={t('Espaces')} className={groupClass}>
                    {spaces.map((s) => (
                      <Command.Item
                        key={s.id}
                        value={`${spaceName(s)}${ID_SEPARATOR}space:${s.id}`}
                        keywords={['espace', 'space', 'profil', 'profile']}
                        className={itemClass}
                        onSelect={() => {
                          choose(() => {
                            useWorkspace.getState().switchSpace(s.id);
                          });
                        }}
                      >
                        <span className="truncate">{spaceName(s)}</span>
                        <span className="ml-auto text-xs text-text-muted">{t('Espace')}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading={t('Commandes')} className={groupClass}>
                  {commands.map((c) => (
                    <Command.Item
                      key={c.id}
                      // Searched as shown, in the interface's language; the keywords add
                      // English words and synonyms, whatever the language.
                      value={`${commandTitle(c)}${ID_SEPARATOR}${c.id}`}
                      keywords={[groupTitle(c.group), ...(c.keywords ?? [])]}
                      className={itemClass}
                      onSelect={() => {
                        choose(() => {
                          runCommand(c.id);
                        });
                      }}
                    >
                      <span className="truncate">{commandTitle(c)}</span>
                      <Shortcut command={c} />
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
